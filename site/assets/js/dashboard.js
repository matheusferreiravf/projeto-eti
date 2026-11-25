// Dashboard da sala — aplicação Vue 3 com Options API, carregada por CDN.
// Equivale ao main.js da aula: cria `app`. Os componentes ficam em
// assets/js/components/ e são registrados com app.component(...).
// A montagem (app.mount) é feita no final do dashboard.html.
//
// Quem fala com os dados é só esta raiz, pela API do ETI.data (data.js).
// Em mounted() ela assina os canais; em unmounted() cancela as assinaturas.

ETI.ui.exigirSessao()
ETI.ui.montarTopo('dashboard.html')

const app = Vue.createApp({
    data() {
        return {
            sala: ETI.data.sala(),
            equipamentos: ETI.data.equipamentos().filter(eq => ETI.data.controlaveis.includes(eq.id)),
            dias: ETI.ui.dias,

            // Valores que chegam dos canais do ETI.data
            telemetria: null,
            estado: null,
            config: null,
            alertas: { ativos: [], registro: [] },
            historico: [],
            ocupacao: ETI.data.ocupacao(),

            // Formulário de regras
            form: { limiteTemp: '', limiteLux: '', horarioEconomia: '' },
            editando: false,
            regrasSalvas: false
        }
    },

    computed: {
        pronto() {
            return !!(this.telemetria && this.estado && this.config)
        },

        // Leituras fora do limite (deixam o card laranja)
        foraTemp() {
            return this.telemetria.temp > this.config.limiteTemp
        },
        foraUmid() {
            return this.telemetria.umid > 75 || this.telemetria.umid < 40
        },
        foraLux() {
            return this.ocupacao.ocupada && this.telemetria.lux < this.config.limiteLux
        },
        foraPessoas() {
            return this.sala.capacidade > 0 && this.telemetria.pessoas > this.sala.capacidade
        },
        lotacaoPct() {
            if (!this.sala.capacidade) return 0
            return Math.min(100, (this.telemetria.pessoas / this.sala.capacidade) * 100)
        },
        lotacaoCheia() {
            return this.sala.capacidade > 0 && this.telemetria.pessoas >= this.sala.capacidade * 0.9
        },

        // Controles
        modoOcupacao() {
            if (!this.ocupacao.manual) return 'grade'
            return this.ocupacao.ocupada ? 'ocupada' : 'vazia'
        },
        notaEconomia() {
            const c = this.config
            if (c.motivoEconomia === 'forcada') return 'Ativado à mão: iluminação, ventilação e projetor desligados e travados.'
            if (c.motivoEconomia === 'horario') return 'Em vigor pelo desligamento programado das ' + c.horarioEconomia + '. Ativar aqui mantém a economia mesmo depois.'
            if (c.motivoEconomia === 'vazia') return 'Em vigor porque a sala está vazia. Ativar aqui mantém a economia mesmo quando a sala voltar a ser usada.'
            return 'Desliga iluminação, ventilação e projetor e trava os controles até ser desativado.'
        },
        notaManual() {
            const c = this.config
            if (c.modoEconomia) return 'Controles travados enquanto o modo economia estiver ativo.'
            if (c.modoManual) return 'Você assumiu os equipamentos. A ventilação e a luz não mudam sozinhas até retomar as automações.'
            return 'Ventilação e luz seguem as regras automaticamente. Mexer em um equipamento suspende as regras.'
        },

        // Gráfico
        graficoRotulos() {
            return this.historico.map(p => ETI.ui.hora(p.ts))
        },
        graficoSeries() {
            return [
                {
                    rotulo: 'Temperatura', cor: '#07296F', eixo: 'y', unidade: '°C', casas: 1,
                    escala: { suggestedMin: 18, suggestedMax: 34 },
                    dados: this.historico.map(p => p.temp)
                },
                {
                    rotulo: 'Luminosidade', cor: '#8DB6FF', eixo: 'y2', unidade: 'lux', casas: 0,
                    escala: { suggestedMin: 0 },
                    dados: this.historico.map(p => p.lux)
                }
            ]
        }
    },

    methods: {
        num(valor, casas) {
            return ETI.ui.numero(valor, casas)
        },
        hora(ts) {
            return ETI.ui.hora(ts)
        },

        // Recebe o evento 'alternar' do componente chave-equipamento
        alternar(id) {
            if (!this.estado || this.config.modoEconomia) return
            ETI.data.setEstado(id, !this.estado[id])
        },
        setOcupacao(valor) {
            ETI.data.setOcupacao(valor)
        },
        alternarEconomia() {
            if (this.config.economiaForcada) ETI.data.desativarEconomia()
            else ETI.data.forcarEconomia()
        },
        retomar() {
            ETI.data.setConfig({ modoManual: false })
        },
        salvarRegras() {
            ETI.data.setConfig({
                limiteTemp: parseFloat(this.form.limiteTemp),
                limiteLux: parseInt(this.form.limiteLux, 10),
                horarioEconomia: this.form.horarioEconomia
            })
            this.regrasSalvas = true
            clearTimeout(this.timerSalvo)
            this.timerSalvo = setTimeout(() => { this.regrasSalvas = false }, 2500)
        },
        reiniciar() {
            if (confirm('Apagar os dados de teste (eventos, gráfico, cartões e bonecos do mapa) e zerar a contagem no Arduino?')) ETI.data.reiniciar()
        }
    },

    mounted() {
        // Cada on* devolve uma função que cancela a assinatura.
        this.cancelamentos = [
            ETI.data.onTelemetria(t => {
                this.telemetria = t
                this.ocupacao = ETI.data.ocupacao()
            }),
            ETI.data.onEstado(e => {
                this.estado = e
            }),
            ETI.data.onConfig(c => {
                this.config = c
                this.ocupacao = ETI.data.ocupacao()
                if (!this.editando) {
                    this.form.limiteTemp = c.limiteTemp
                    this.form.limiteLux = c.limiteLux
                    this.form.horarioEconomia = c.horarioEconomia
                }
            }),
            ETI.data.onAlertas(a => {
                this.alertas = a
            }),
            ETI.data.onHistorico(h => {
                this.historico = h
            })
        ]
    },

    unmounted() {
        this.cancelamentos.forEach(cancelar => cancelar())
    }
})
