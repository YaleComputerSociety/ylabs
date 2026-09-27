import type net from 'net';

export function lineReader(onMessage: (message: unknown) => void): (chunk: Buffer) => void {
  let buffered = '';
  return (chunk) => {
    buffered += chunk.toString('utf8');
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim()) {
        try {
          onMessage(JSON.parse(line));
        } catch {
          return;
        }
      }
      newline = buffered.indexOf('\n');
    }
  };
}

export function writeLine(socket: net.Socket, message: object): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}
