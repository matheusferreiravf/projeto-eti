# Sala Inteligente

Protótipo de sala inteligente com **Arduino Nano**, **Firebase Realtime Database** e o
dashboard do **ETI (Escola Tecnológica Inteligente)**.

O Arduino mede temperatura e umidade (DHT22), luz (LDR), movimento (HC-SR501),
temperatura do projetor (DS18B20 colado no aparelho) e controla quem entra e sai pelo cartão (RC522).
Um LED faz o papel da lâmpada da sala.

```
Arduino ──USB──> computador da sala (Chrome, "Conectar Arduino") ──> Firebase ──> site (qualquer lugar)
        <──USB── comandos (MOV, LUZ 1, TEMPO 30…)                <── Firebase <── botões do site
```

## Pastas

| Pasta | O que tem |
|---|---|
| `arduino/sala_inteligente/` | Código do Arduino (abrir no Arduino IDE) |
| `site/` | Site estático (dashboard, mapa, energia, avisos, relatório, painel de TV) |
| `servidor-local.js` | Servidor para testar o site no computador |

## Montagem

| Peça | Ligação |
|---|---|
| DHT22 | VCC 5V · DATA D2 · GND · 10k entre VCC e DATA |
| HC-SR501 (PIR) | VCC 5V · OUT D3 · GND |
| LED (lâmpada) | D4 → 680 Ω → perna longa · perna curta no GND |
| DS18B20 (projetor) | vermelho 5V · amarelo D5 · preto GND · ~5k (2×10k em paralelo) entre 5V e amarelo |
| LDR | 5V → LDR → A0 → 10k → GND |
| RC522 (RFID) | SDA D10 · SCK D13 · MOSI D11 · MISO D12 · RST D9 · 3,3V · GND |
| Ventoinha (ar) | D6 → 3×680 Ω em paralelo → base do E13009 (esq.) · coletor (meio) no fio preto · emissor (dir.) no GND · fio amarelo no +5V · verde solto |

Placa: Arduino Nano, processador **ATmega328P** (sem Old Bootloader).

Bibliotecas: DHT sensor library + Adafruit Unified Sensor, MFRC522, OneWire, DallasTemperature.

## Regras da sala (no Arduino)

1. Cartão novo → porta liberada por 15 s (até 40 pessoas); com movimento no PIR → **entrada** (+1).
2. Cartão de quem já está dentro → **saída** (−1).
3. Movimento com a sala vazia e sem cartão → alerta de **intruso**.
4. Gente na sala e nenhum movimento pelo tempo configurado → **inatividade** e a lâmpada apaga.
5. Lâmpada acende quando alguém entra no escuro e apaga quando a última pessoa sai.
6. **Ar-condicionado** liga quando alguém que entrou pelo cartão se mexe com a sala acima do limite (28 °C por padrão) e desliga na inatividade, com a sala vazia ou no zerar. A temperatura do ar começa em 21 °C (16 a 30).
7. A temperatura da sala pode vir do DHT22 ou ser **simulada**: com o ar ligado ela cai 0,2 °C/s até a temperatura do ar; desligado, volta a subir até o valor escolhido.

Comandos pela serial: MOV, LUZ 1/0, AR 1/0, SETAR n, LIMITE n, SIM n, SIM OFF, TEMPO n, LUZMIN n, AUTO 1/0, ZERAR, STATUS.

## Regras do site (rodam no computador da ponte)

- **Ocupação**: ocupada quando alguém entrou pelo cartão ou no horário de aulas (grade). Pode ser marcada à mão como ocupada ou vazia por 3 horas.
- **Modo economia**: com a sala vazia, depois do desligamento programado (23:00) ou ativado à mão, desliga luz, ar, ventilação e projetor e trava os controles (manda AUTO 0 ao Arduino).
- **Controle manual**: mexer num equipamento suspende as automações (AUTO 0) até "Retomar automações".
- **Ventilação** (só no site): liga acima do limite de temperatura e desliga 1,5 °C abaixo.
- **Energia**: consumo e custo por equipamento, economia com as automações e retorno de energia solar.
- **Perfis**: `perfis/<uid>` no Firebase com "professor" esconde Avisos e Relatório; sem nada, o usuário é gestor.

## Testar o site no computador

```bash
node servidor-local.js
```

Abra http://localhost:5500 no **Chrome ou Edge**, entre com o seu usuário do Firebase e clique em **Conectar Arduino**
(feche antes o Monitor Serial do Arduino IDE: a porta USB só pode ser usada por um programa).

## Configuração e segurança

- `site/assets/js/firebase-config.js` fica só no seu computador (está no `.gitignore`).
  Para montar em outro computador, copie `firebase-config.exemplo.js` com esse nome e preencha
  com os dados do console do Firebase (Configurações do projeto → Seus apps).
- O site exige login (Firebase Authentication, e-mail e senha). As regras do Realtime Database
  só deixam ler e gravar o usuário dono do projeto; qualquer outro acesso recebe "Permission denied".
