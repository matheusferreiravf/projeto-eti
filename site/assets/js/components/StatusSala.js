// Frase que descreve a situação da sala.
// `curto` é a versão do painel de TV ("Sala em uso", "Sala vazia"...).
app.component('status-sala', {
    props: {
        ocupada: {
            type: Boolean,
            default: false
        },
        modoEconomia: {
            type: Boolean,
            default: false
        },
        modoManual: {
            type: Boolean,
            default: false
        },
        horarioEconomia: {
            type: String,
            default: ''
        },
        motivoEconomia: {
            type: String,
            default: null
        },
        marcadaManual: {
            type: Boolean,
            default: false
        },
        marcadaAte: {
            type: Number,
            default: null
        },
        curto: {
            type: Boolean,
            default: false
        }
    },
    template: /*html*/ `<span>{{ frase }}</span>`,
    computed: {
        textoOcupacao() {
            if (this.marcadaManual) {
                return (this.ocupada ? 'Sala marcada como ocupada' : 'Sala marcada como vazia') +
                    (this.marcadaAte ? ' até as ' + ETI.ui.hora(this.marcadaAte) : '')
            }
            return this.ocupada
                ? 'Sala ocupada pelo horário de aulas'
                : 'Sala vazia, fora do horário de aulas'
        },
        textoAutomacao() {
            if (this.modoEconomia) {
                if (this.motivoEconomia === 'forcada') return 'Modo economia ativado manualmente, equipamentos desligados'
                if (this.motivoEconomia === 'horario') return 'Desligamento programado das ' + this.horarioEconomia + ' em vigor, equipamentos desligados'
                return 'Equipamentos desligados porque a sala está vazia'
            }
            return this.modoManual
                ? 'Equipamentos no controle manual, limites automáticos suspensos'
                : 'Automações ativas'
        },
        frase() {
            if (this.curto) {
                if (this.modoEconomia) return 'Modo economia, equipamentos desligados'
                return this.ocupada ? 'Sala em uso' : 'Sala vazia'
            }
            return this.textoOcupacao + '. ' + this.textoAutomacao + '.'
        }
    }
})
