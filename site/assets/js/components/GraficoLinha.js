// Gráfico de linhas sobre o Chart.js.
// series: [{ rotulo, dados: [], cor, eixo: 'y' | 'y2', unidade, casas, escala }]
//
// O objeto do Chart.js é guardado em this.chart dentro de mounted(), SEM declarar
// em data(). Assim ele fica fora da reatividade: se estivesse em data(), o Vue
// tentaria observar o objeto inteiro do Chart.js e a página ficaria lenta.
// Quando os dados mudam, o gráfico é atualizado com update('none'); nunca é
// destruído e recriado, senão piscaria a cada 3 segundos.
app.component('grafico-linha', {
    props: {
        rotulos: {
            type: Array,
            default() { return [] }
        },
        series: {
            type: Array,
            default() { return [] }
        },
        altura: {
            type: Number,
            default: 240
        }
    },
    template: /*html*/ `
        <div class="grafico" :style="{ height: altura + 'px' }">
            <canvas ref="canvas"></canvas>
        </div>
    `,
    computed: {
        // Junta as duas props para observar uma coisa só no watch.
        dadosDoGrafico() {
            return [this.rotulos, this.series]
        }
    },
    watch: {
        dadosDoGrafico() {
            this.atualizar()
        }
    },
    methods: {
        copiar(lista) {
            return Vue.toRaw(lista).slice()
        },
        montarDatasets() {
            return this.series.map(s => ({
                label: s.rotulo,
                data: this.copiar(s.dados),
                borderColor: s.cor,
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 14,
                tension: 0.25,
                yAxisID: s.eixo || 'y'
            }))
        },
        atualizar() {
            if (!this.chart) return
            this.chart.data.labels = this.copiar(this.rotulos)
            this.series.forEach((s, i) => {
                if (this.chart.data.datasets[i]) this.chart.data.datasets[i].data = this.copiar(s.dados)
            })
            this.chart.update('none')
        }
    },
    mounted() {
        const base = ETI.ui.chartBase()
        const escalas = { x: base.eixoX }
        this.series.forEach(s => {
            const id = s.eixo || 'y'
            if (escalas[id]) return
            escalas[id] = id === 'y'
                ? Object.assign({}, base.eixoY, s.escala || {})
                : Object.assign({}, base.eixoX, { position: 'right' }, s.escala || {})
        })

        const series = this.series
        this.chart = new Chart(this.$refs.canvas, {
            type: 'line',
            data: { labels: this.copiar(this.rotulos), datasets: this.montarDatasets() },
            options: Object.assign({}, base.opcoes, {
                plugins: Object.assign({}, base.opcoes.plugins, {
                    tooltip: Object.assign({}, base.opcoes.plugins.tooltip, {
                        callbacks: {
                            label(ctx) {
                                const s = series[ctx.datasetIndex] || {}
                                return ETI.ui.numero(ctx.parsed.y, s.casas || 0) + (s.unidade ? ' ' + s.unidade : '')
                            }
                        }
                    })
                }),
                scales: escalas
            })
        })
    },
    unmounted() {
        if (this.chart) this.chart.destroy()
        this.chart = null
    }
})
