import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import { URL } from 'url';
import * as net from 'net';

import { config } from './config';

const httpServer = http.createServer(onRequest);
const httpsServer = https.createServer(
  {
    key: fs.readFileSync(config.key),
    cert: fs.readFileSync(config.cert)
  },
  onRequest
);

httpServer.on('connect', onConnect);
httpsServer.on('connect', onConnect);

httpServer.on('error', err => {
  console.error(err);

  throw err;
});
httpsServer.on('error', err => {
  console.error(err);

  throw err;
});

function isAuthorized(proxyAuth: string): boolean {
  if (!proxyAuth) {
    return false;
  }

  const baseToBuffer = Buffer.from(proxyAuth.slice(6), 'base64');

  const authString = baseToBuffer.toString('ascii');

  const [login, password] = authString.split(':');

  if (!config.users[login]) {
    return false;
  }

  if (config.users[login] !== password) {
    return false;
  }

  return true;
}

function onConnect(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
  socket.on('error', err => {
    console.error('socket', err.message, req.url);

    socket.end();
  });

  const [urlHost, urlPort] = req.url.split(':');

  const port = parseInt(urlPort) || 443;

  if (!isAuthorized(req.headers['proxy-authorization'])) {
    socket.write(
      ['HTTP/1.1 407 Proxy Authentication Required', 'Proxy-Authenticate: Basic'].join('\n') + '\n\n',
      () => {
        socket.end();
      }
    );
  } else {
    const netConnect = net.connect(port, urlHost, () => {
      socket.write(['HTTP/1.1 200 OK'].join('\n') + '\n\n', () => {
        netConnect.pipe(socket);

        socket.pipe(netConnect);
      });
    });

    netConnect.on('error', err => {
      console.error('netConnect', err.message, req.url, urlHost);

      socket.end();
    });
  }
}

function onRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse) {
  let url;

  try {
    url = new URL(clientReq.url);
  } catch (err) {
    clientRes.write(err.message, 'utf8');

    clientRes.end();

    return;
  }

  const options = {
    hostname: url.hostname,
    port: url.port || 80,
    path: ''.concat(url.pathname, url.search, url.hash),
    method: clientReq.method,
    headers: clientReq.headers
  };

  if (!isAuthorized(clientReq.headers['proxy-authorization'])) {
    clientRes.writeHead(407, { 'Proxy-Authenticate': 'Basic' });

    clientRes.end();
  } else {
    const proxy = http.request(options, res => {
      clientRes.writeHead(res.statusCode, res.headers);

      res.pipe(
        clientRes,
        {
          end: true
        }
      );
    });

    proxy.on('error', err => {
      console.error('proxy', err.message, clientReq.url, url.hostname);

      clientRes.write(err.message, 'utf8');

      clientRes.end();
    });

    clientReq.pipe(
      proxy,
      {
        end: true
      }
    );
  }
}

process.on('unhandledRejection', (reason, p) => {
  throw reason;
});

if (config.httpPort) {
  httpServer.listen(config.httpPort);

  console.log('http proxy is running...');
}

if (config.httpsPort) {
  httpsServer.listen(config.httpsPort);

  console.log('https proxy is running...');
}