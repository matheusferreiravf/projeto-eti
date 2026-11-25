#include <SPI.h>
#include <MFRC522.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#define PINO_DHT    2
#define PINO_PIR    3
#define PINO_LED    4
#define PINO_EQUIP   5
#define PINO_AR     6
#define PINO_RST    9
#define PINO_SS    10
#define PINO_LDR   A0

#define MAX_PESSOAS          40
#define INTERVALO_STATUS   2000UL
#define JANELA_ENTRADA    15000UL
#define ANTIREPIQUE_CARTAO 3000UL
#define DURACAO_MOV        3000UL
#define CARENCIA_SAIDA    10000UL
#define PASSO_SIMULACAO    1000UL
#define RESFRIAR_POR_SEG     0.2
#define AQUECER_POR_SEG      0.1
// Sem ouvir o site por esse tempo, a placa volta para o automático sozinha.
#define SITE_SUMIU        60000UL

MFRC522 rfid(PINO_SS, PINO_RST);
DHT dht(PINO_DHT, DHT22);
OneWire umFio(PINO_EQUIP);
DallasTemperature sensorEquip(&umFio);

unsigned long presentes[MAX_PESSOAS];
byte totalPessoas = 0;

unsigned long cartaoPendente = 0;
unsigned long inicioPendente = 0;

unsigned long tempoInatividade = 30000UL;
unsigned long ultimoMovimento = 0;
unsigned long ultimaSaida = 0;
bool pirAnterior = false;
bool avisouInatividade = false;
bool lampada = false;
// Luz fixa (FIXA 1): o LED fica aceso e nada apaga, nem inatividade, nem sala vazia, nem economia.
bool luzFixa = false;

bool ar = false;
// Automático: a lâmpada e o ar ligam sozinhos. O site desliga (AUTO 0) no controle manual e no modo economia.
bool automatico = true;
unsigned long ultimoComandoSite = 0;
int limiarClaro = 700;   // LDR acima disso = claro (o site muda com LUZMIN n)
float limiteAr = 28.0;
byte setpointAr = 21;
bool usarSimulada = false;
float tempSimulada = 30.0;
float tempSimAlvo = 30.0;
float ultimaTemp = NAN;
unsigned long ultimaSimulacao = 0;

unsigned long ultimoStatus = 0;
unsigned long ultimoCartao = 0;
unsigned long tempoUltimoCartao = 0;

char comando[20];
byte tamComando = 0;

void imprimirNumero(float valor) {
  if (isnan(valor)) Serial.print(F("null"));
  else Serial.print(valor, 1);
}

void enviarEvento(const __FlashStringHelper* acao, unsigned long uid) {
  Serial.print(F("{\"tipo\":\"evento\",\"acao\":\""));
  Serial.print(acao);
  Serial.print(F("\""));
  if (uid != 0) {
    Serial.print(F(",\"cartao\":\""));
    Serial.print(uid, HEX);
    Serial.print(F("\""));
  }
  Serial.print(F(",\"pessoas\":"));
  Serial.print(totalPessoas);
  Serial.println(F("}"));
}

void enviarStatus() {
  float temperatura = dht.readTemperature();
  ultimaTemp = temperatura;
  float umidade     = dht.readHumidity();

  // DS18B20 colado no projetor: temperatura do equipamento.
  float equip = sensorEquip.getTempCByIndex(0);
  if (equip == DEVICE_DISCONNECTED_C) equip = NAN;
  sensorEquip.requestTemperatures();

  int luz = analogRead(PINO_LDR);
  bool movimento = digitalRead(PINO_PIR) == HIGH ||
                   (ultimoMovimento != 0 && millis() - ultimoMovimento < DURACAO_MOV);

  Serial.print(F("{\"tipo\":\"status\",\"temp\":"));
  imprimirNumero(temperatura);
  Serial.print(F(",\"umid\":"));
  imprimirNumero(umidade);
  Serial.print(F(",\"equip\":"));
  imprimirNumero(equip);
  Serial.print(F(",\"luz\":"));
  Serial.print(luz);
  Serial.print(F(",\"claro\":"));
  Serial.print(luz > limiarClaro ? 1 : 0);
  Serial.print(F(",\"luzmin\":"));
  Serial.print(limiarClaro);
  Serial.print(F(",\"auto\":"));
  Serial.print(automatico ? 1 : 0);
  Serial.print(F(",\"lampada\":"));
  Serial.print(lampada ? 1 : 0);
  Serial.print(F(",\"fixa\":"));
  Serial.print(luzFixa ? 1 : 0);
  Serial.print(F(",\"mov\":"));
  Serial.print(movimento ? 1 : 0);
  Serial.print(F(",\"pessoas\":"));
  Serial.print(totalPessoas);
  Serial.print(F(",\"porta\":"));
  Serial.print(cartaoPendente != 0 ? 1 : 0);
  Serial.print(F(",\"inatividade\":"));
  Serial.print(tempoInatividade / 1000);
  Serial.print(F(",\"ar\":"));
  Serial.print(ar ? 1 : 0);
  Serial.print(F(",\"setar\":"));
  Serial.print(setpointAr);
  Serial.print(F(",\"limite\":"));
  Serial.print(limiteAr, 1);
  Serial.print(F(",\"sim\":"));
  imprimirNumero(usarSimulada ? tempSimulada : NAN);
  Serial.println(F("}"));
}

float temperaturaSala() {
  return usarSimulada ? tempSimulada : ultimaTemp;
}

bool estaEscuro() {
  return analogRead(PINO_LDR) <= limiarClaro;
}

void enviarMudanca(const __FlashStringHelper* acao, bool ligar, const __FlashStringHelper* motivo) {
  Serial.print(F("{\"tipo\":\"evento\",\"acao\":\""));
  Serial.print(acao);
  Serial.print(F("\",\"estado\":"));
  Serial.print(ligar ? 1 : 0);
  Serial.print(F(",\"motivo\":\""));
  Serial.print(motivo);
  Serial.print(F("\",\"pessoas\":"));
  Serial.print(totalPessoas);
  Serial.println(F("}"));
}

void mudarLampada(bool ligar, const __FlashStringHelper* motivo) {
  if (ligar == lampada) return;
  if (!ligar && luzFixa) return;   // luz fixa: ninguém apaga
  lampada = ligar;
  digitalWrite(PINO_LED, ligar ? HIGH : LOW);
  enviarMudanca(F("lampada"), ligar, motivo);
}

void mudarAr(bool ligar, const __FlashStringHelper* motivo) {
  if (ligar == ar) return;
  ar = ligar;
  digitalWrite(PINO_AR, ligar ? HIGH : LOW);
  enviarMudanca(F("ar"), ligar, motivo);
}

void verificarAr() {
  float t = temperaturaSala();
  if (automatico && !ar && totalPessoas > 0 && !isnan(t) && t > limiteAr) mudarAr(true, F("calor"));
}

void simularTemperatura() {
  if (!usarSimulada || millis() - ultimaSimulacao < PASSO_SIMULACAO) return;
  ultimaSimulacao = millis();
  if (ar && tempSimulada > setpointAr) {
    tempSimulada = max((float)setpointAr, tempSimulada - RESFRIAR_POR_SEG);
  } else if (!ar && tempSimulada < tempSimAlvo) {
    tempSimulada = min(tempSimAlvo, tempSimulada + AQUECER_POR_SEG);
  }
}

unsigned long lerUID() {
  unsigned long uid = 0;
  for (byte i = 0; i < 4 && i < rfid.uid.size; i++) {
    uid = (uid << 8) | rfid.uid.uidByte[i];
  }
  return uid;
}

int procurar(unsigned long uid) {
  for (int i = 0; i < totalPessoas; i++) {
    if (presentes[i] == uid) return i;
  }
  return -1;
}

void registrarCartao(unsigned long uid) {
  int pos = procurar(uid);

  if (pos >= 0) {
    presentes[pos] = presentes[totalPessoas - 1];
    totalPessoas--;
    enviarEvento(F("saida"), uid);
    if (totalPessoas == 0) {
      ultimaSaida = millis();
      avisouInatividade = false;
      mudarLampada(false, F("sala_vazia"));
      mudarAr(false, F("sala_vazia"));
    }
  } else if (totalPessoas >= MAX_PESSOAS) {
    enviarEvento(F("lotada"), uid);
  } else {
    cartaoPendente = uid;
    inicioPendente = millis();
    enviarEvento(F("porta_liberada"), uid);
  }
}

void aoDetectarMovimento(bool virtualMov) {

  if (cartaoPendente == 0 && totalPessoas == 0 &&
      ultimaSaida != 0 && millis() - ultimaSaida < CARENCIA_SAIDA) {
    return;
  }

  ultimoMovimento = millis();
  avisouInatividade = false;
  if (virtualMov) enviarEvento(F("movimento_virtual"), 0);

  if (cartaoPendente != 0) {
    presentes[totalPessoas] = cartaoPendente;
    totalPessoas++;
    enviarEvento(F("entrada"), cartaoPendente);
    cartaoPendente = 0;
    if (automatico && estaEscuro()) mudarLampada(true, F("entrada"));
    verificarAr();
  } else if (totalPessoas == 0) {
    enviarEvento(F("intruso"), 0);
  } else {
    if (automatico && !lampada && estaEscuro()) mudarLampada(true, F("movimento"));
    verificarAr();
  }
}

void verificarTempos() {

  // O site mandou AUTO 0 (economia ou manual) e depois sumiu: a sala volta a se cuidar sozinha.
  if (!automatico && millis() - ultimoComandoSite > SITE_SUMIU) {
    automatico = true;
    enviarStatus();
  }

  if (cartaoPendente != 0 && millis() - inicioPendente > JANELA_ENTRADA) {
    enviarEvento(F("entrada_cancelada"), cartaoPendente);
    cartaoPendente = 0;
  }

  if (totalPessoas > 0 && !avisouInatividade &&
      millis() - ultimoMovimento > tempoInatividade) {
    avisouInatividade = true;
    enviarEvento(F("inatividade"), 0);
    mudarLampada(false, F("inatividade"));
    mudarAr(false, F("inatividade"));
  }
}

void executarComando(char* cmd) {
  ultimoComandoSite = millis();
  if (strcmp(cmd, "MOV") == 0) {
    aoDetectarMovimento(true);
  } else if (strcmp(cmd, "LUZ 1") == 0) {
    mudarLampada(true, F("manual"));
  } else if (strcmp(cmd, "LUZ 0") == 0) {
    mudarLampada(false, F("manual"));
  } else if (strncmp(cmd, "TEMPO ", 6) == 0) {
    long segundos = atol(cmd + 6);
    if (segundos >= 5) {
      tempoInatividade = (unsigned long)segundos * 1000UL;
      avisouInatividade = false;
    }
    enviarStatus();
  } else if (strcmp(cmd, "AR 1") == 0) {
    mudarAr(true, F("manual"));
  } else if (strcmp(cmd, "AR 0") == 0) {
    mudarAr(false, F("manual"));
  } else if (strncmp(cmd, "SETAR ", 6) == 0) {
    int graus = atoi(cmd + 6);
    if (graus >= 16 && graus <= 30) setpointAr = graus;
    enviarStatus();
  } else if (strncmp(cmd, "LIMITE ", 7) == 0) {
    float graus = atof(cmd + 7);
    if (graus >= 10 && graus <= 45) limiteAr = graus;
    enviarStatus();
  } else if (strcmp(cmd, "SIM OFF") == 0) {
    usarSimulada = false;
    enviarStatus();
  } else if (strncmp(cmd, "SIM ", 4) == 0) {
    float graus = atof(cmd + 4);
    if (graus >= 0 && graus <= 50) {
      usarSimulada = true;
      tempSimulada = graus;
      tempSimAlvo = graus;
    }
    enviarStatus();
  } else if (strcmp(cmd, "AUTO 1") == 0) {
    automatico = true;
    enviarStatus();
  } else if (strcmp(cmd, "AUTO 0") == 0) {
    automatico = false;
    enviarStatus();
  } else if (strncmp(cmd, "LUZMIN ", 7) == 0) {
    int v = atoi(cmd + 7);
    if (v >= 0 && v <= 1023) limiarClaro = v;
    enviarStatus();
  } else if (strcmp(cmd, "FIXA 1") == 0) {
    luzFixa = true;
    mudarLampada(true, F("fixa"));
    enviarStatus();
  } else if (strcmp(cmd, "FIXA 0") == 0) {
    luzFixa = false;
    // Soltou: se a sala está vazia, apaga; com gente, segue as regras normais.
    if (totalPessoas == 0) mudarLampada(false, F("sala_vazia"));
    enviarStatus();
  } else if (strcmp(cmd, "ZERAR") == 0) {
    totalPessoas = 0;
    cartaoPendente = 0;
    avisouInatividade = false;
    mudarLampada(false, F("zerar"));
    mudarAr(false, F("zerar"));
    enviarEvento(F("zerado"), 0);
  } else if (strcmp(cmd, "STATUS") == 0) {
    enviarStatus();
  } else {
    Serial.println(F("{\"tipo\":\"erro\",\"msg\":\"comando desconhecido\"}"));
  }
}

void lerComandos() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      comando[tamComando] = '\0';
      if (tamComando > 0) executarComando(comando);
      tamComando = 0;
    } else if (tamComando < sizeof(comando) - 1) {
      comando[tamComando++] = toupper(c);
    }
  }
}

void setup() {
  Serial.begin(9600);
  SPI.begin();
  rfid.PCD_Init();
  dht.begin();

  sensorEquip.begin();
  sensorEquip.setWaitForConversion(false);
  sensorEquip.requestTemperatures();

  pinMode(PINO_PIR, INPUT);
  pinMode(PINO_LED, OUTPUT);
  digitalWrite(PINO_LED, LOW);
  pinMode(PINO_AR, OUTPUT);
  digitalWrite(PINO_AR, LOW);

  Serial.println(F("{\"tipo\":\"inicio\"}"));
}

void loop() {

  lerComandos();

  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    unsigned long uid = lerUID();
    if (uid != ultimoCartao || millis() - tempoUltimoCartao > ANTIREPIQUE_CARTAO) {
      registrarCartao(uid);
    }
    ultimoCartao = uid;
    tempoUltimoCartao = millis();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  bool pir = digitalRead(PINO_PIR) == HIGH;
  if (pir && !pirAnterior) aoDetectarMovimento(false);
  pirAnterior = pir;

  verificarTempos();
  simularTemperatura();

  if (millis() - ultimoStatus >= INTERVALO_STATUS) {
    ultimoStatus = millis();
    enviarStatus();
  }
}
