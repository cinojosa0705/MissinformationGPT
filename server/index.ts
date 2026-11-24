import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)

createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true }))
  }
  res.writeHead(404).end()
}).listen(PORT, () => console.log(`api on :${PORT}`))
