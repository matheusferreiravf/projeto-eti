const http = require('http')
const fs = require('fs')
const path = require('path')

const PASTA = path.join(__dirname, 'site')
const PORTA = process.env.PORT || 5500
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon'
}

http.createServer((req, res) => {
  let caminho = decodeURIComponent(req.url.split('?')[0])
  if (caminho.endsWith('/')) caminho += 'index.html'
  const arquivo = path.join(PASTA, path.normalize(caminho))
  if (!arquivo.startsWith(PASTA)) { res.writeHead(403); return res.end() }
  fs.readFile(arquivo, (erro, dados) => {
    if (erro) { res.writeHead(404); return res.end('Não encontrado') }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' })
    res.end(dados)
  })
}).listen(PORTA, '0.0.0.0', () => console.log('Site em http://localhost:' + PORTA + ' (outros computadores da rede: http://IP-deste-computador:' + PORTA + ')'))
