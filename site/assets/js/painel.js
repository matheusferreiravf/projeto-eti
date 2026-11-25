// Painel de TV — aplicação Vue 3 com Options API, carregada por CDN. Abre sem login.
// Cria `app`; os componentes vêm de assets/js/components/ e a montagem
// (app.mount) é feita no final do painel.html.
// Tecla F: tela cheia. Setas: passam os avisos na mão.
// Os alertas do sistema entram na frente dos avisos; um alerta novo aparece na hora.

const ROTACAO_MS = 9000

const app = Vue.createApp({
    data() {
        return {
            sala: ETI.data.sala(),
            telemetria: null,
            config: null,
            ocupada: ETI.data.ocupada(),
            alertas: [],
            avisos: [],
            indice: 0,
            hora: ETI.ui.hora(Date.now())
        }
    },

    computed: {
        // Alertas primeiro, depois os avisos publicados
        itens() {
            const alertas = this.alertas.map(a => ({
                chave: 'alerta:' + a.id, alerta: true, titulo: a.titulo, texto: a.texto
            }))
            const avisos = this.avisos.map(a => ({
                chave: 'aviso:' + a.id, alerta: false, titulo: a.titulo, texto: a.texto
            }))
            return alertas.concat(avisos)
        },
        atual() {
            if (!this.itens.length) return null
            return this.itens[this.indice % this.itens.length]
        }
    },

    watch: {
        // Os alertas chegam a cada 3 s com o texto atualizado: mantém a posição,
        // a não ser que tenha surgido um alerta novo, que passa para a frente.
        itens(novos, velhos) {
            const antes = velhos.map(i => i.chave)
            const depois = novos.map(i => i.chave)
            const chaveAtual = velhos.length ? velhos[this.indice % velhos.length].chave : null

            const novoAlerta = novos.find(i => i.alerta && !antes.includes(i.chave))
            if (novoAlerta) {
                this.indice = depois.indexOf(novoAlerta.chave)
            } else {
                const pos = chaveAtual ? depois.indexOf(chaveAtual) : -1
                this.indice = pos >= 0 ? pos : 0
            }

            if (antes.join('|') !== depois.join('|')) this.reagendar()
        }
    },

    methods: {
        num(valor, casas) {
            return ETI.ui.numero(valor, casas)
        },
        reagendar() {
            clearInterval(this.timerRotacao)
            this.timerRotacao = setInterval(() => {
                if (this.itens.length > 1) this.indice = (this.indice + 1) % this.itens.length
            }, ROTACAO_MS)
        },
        teclado(e) {
            if (e.key === 'f' || e.key === 'F') {
                const p = document.fullscreenElement
                    ? document.exitFullscreen()
                    : document.documentElement.requestFullscreen()
                if (p && p.catch) p.catch(() => {})
                return
            }
            const n = this.itens.length
            if (!n) return
            if (e.key === 'ArrowRight') this.indice = (this.indice + 1) % n
            else if (e.key === 'ArrowLeft') this.indice = (this.indice - 1 + n) % n
            else return
            this.reagendar()
        }
    },

    mounted() {
        this.cancelamentos = [
            ETI.data.onTelemetria(t => {
                this.telemetria = t
                this.ocupada = ETI.data.ocupada()
            }),
            ETI.data.onConfig(c => {
                this.config = c
                this.ocupada = ETI.data.ocupada()
            }),
            ETI.data.onAlertas(a => {
                this.alertas = a.ativos
            }),
            ETI.data.onAvisos(lista => {
                this.avisos = lista.filter(a => a.ativo)
            })
        ]

        this.timerRelogio = setInterval(() => {
            this.hora = ETI.ui.hora(Date.now())
        }, 1000)

        this.reagendar()
        document.addEventListener('keydown', this.teclado)
    },

    unmounted() {
        this.cancelamentos.forEach(cancelar => cancelar())
        clearInterval(this.timerRelogio)
        clearInterval(this.timerRotacao)
        document.removeEventListener('keydown', this.teclado)
    }
})
