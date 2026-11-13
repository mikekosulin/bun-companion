const [name = 'server', port = '3000'] = process.argv.slice(2);
const server = Bun.serve({ port: Number(port), fetch: () => new Response(`${name} is running`) });
console.log(`${name} listening on http://localhost:${server.port}`);
setInterval(() => console.log(`${name}: ${new Date().toLocaleTimeString()} GET / 200`), 2000);
