// Um indicador da sala (temperatura, umidade, luz, lotação, potência).
// Usado no dashboard e, com a prop `escuro`, no painel de TV.
app.component('card-leitura', {
    props: {
        rotulo: {
            type: String,
            required: true
        },
        valor: {
            type: [String, Number],
            default: '—'
        },
        unidade: {
            type: String,
            default: ''
        },
        foraDoLimite: {
            type: Boolean,
            default: false
        },
        escuro: {
            type: Boolean,
            default: false
        }
    },
    template: /*html*/ `
        <div class="leitura" :class="{ fora: foraDoLimite, 'leitura-tv': escuro }">
            <span class="rotulo">{{ rotulo }}</span>
            <span class="valor">{{ valor }}<i v-if="unidade">{{ unidade }}</i></span>
            <slot></slot>
        </div>
    `
})
