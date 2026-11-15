import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/**
 * WebSocket mínimo (RFC 6455) só com a biblioteca padrão do Node — o ambiente do projeto
 * não tem acesso ao npm, então não usamos o pacote "ws". Suporta texto, ping/pong,
 * fechamento, quadros fragmentados e payloads grandes (64 bits).
 */
export class WsConn {
  private buf = Buffer.alloc(0);
  private frag: Buffer[] = [];
  open = true;
  onMessage: (text: string) => void = () => {};
  onClose: () => void = () => {};

  constructor(private sock: Duplex) {
    sock.on('data', (d: Buffer) => this.feed(d));
    sock.on('close', () => this.closed());
    sock.on('error', () => this.closed());
  }

  private closed() {
    if (!this.open) return;
    this.open = false;
    this.onClose();
  }

  private feed(d: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskOff = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      const payload = Buffer.from(this.buf.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= this.buf[maskOff + (i & 3)];
      this.buf = this.buf.subarray(off + len);
      if (op === 0x8) {
        this.close();
        return;
      }
      if (op === 0x9) {
        this.frame(0xa, payload);
        continue;
      }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0 || op === 0x2) {
        this.frag.push(payload);
        if (fin) {
          const all = Buffer.concat(this.frag);
          this.frag = [];
          try {
            this.onMessage(all.toString('utf8'));
          } catch (e) {
            console.error('[ws] erro ao tratar mensagem', e);
          }
        }
      }
    }
  }

  private frame(op: number, data: Buffer) {
    if (!this.open) return;
    const len = data.length;
    let head: Buffer;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    this.sock.write(Buffer.concat([head, data]));
  }

  send(text: string) {
    this.frame(0x1, Buffer.from(text, 'utf8'));
  }

  close() {
    if (!this.open) return;
    try {
      this.frame(0x8, Buffer.alloc(0));
    } catch {
      /* já fechado */
    }
    this.sock.end();
    this.closed();
  }
}

/** Responde ao "upgrade" HTTP e devolve a conexão WebSocket. */
export function acceptUpgrade(req: IncomingMessage, sock: Duplex): WsConn | null {
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || (req.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
    sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  (sock as Duplex & { setNoDelay?: (b: boolean) => void }).setNoDelay?.(true);
  return new WsConn(sock);
}
