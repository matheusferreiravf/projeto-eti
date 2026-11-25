// Linha de um equipamento com a chave liga/desliga.
// O componente não liga nada sozinho: emite 'alternar' e o pai decide o que fazer.
app.component('chave-equipamento', {
    props: {
        nome: {
            type: String,
            required: true
        },
        detalhe: {
            type: String,
            default: ''
        },
        potencia: {
            type: Number,
            default: 0
        },
        ligado: {
            type: Boolean,
            default: false
        },
        travado: {
            type: Boolean,
            default: false
        }
    },
    emits: ['alternar'],
    template: /*html*/ `
        <div class="item">
            <span class="nome">{{ nome }}
                <span class="sub">
                    {{ detalhe }}, {{ potencia }} W ·
                    <span class="estado-eq" :class="{ ligado: ligado }">
                        <i class="bi" :class="ligado ? 'bi-lightning-charge-fill' : 'bi-power'" aria-hidden="true"></i>
                        {{ ligado ? 'ligado' : 'desligado' }}
                    </span>
                </span>
            </span>
            <button
                type="button"
                class="chave"
                :aria-pressed="String(ligado)"
                :aria-label="nome"
                :disabled="travado"
                @click="alternar">
            </button>
        </div>
    `,
    methods: {
        alternar() {
            if (this.travado) return
            this.$emit('alternar')
        }
    }
})
