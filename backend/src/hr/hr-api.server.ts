import { createServer, Server as HttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { HrData } from './hr-data';

export const HR_SERVICE_KEY_HEADER = 'x-hr-service-key';

/**
 * A pretend external HR system (think Workday or Personio), as its own small web service.
 *
 *   GET /employees/<userId>/leave    one person's leave balance
 *   GET /employees/<userId>/salary   one person's pay
 *
 * It only accepts callers with the service key (here: the MCP service). It answers for the
 * person in the URL and nobody else. Deciding whether the asking user may see that person
 * is the MCP service's job. A real HR API would also check the user's own token.
 */
export class HrApiServer {
  private httpServer?: HttpServer;

  constructor(
    private readonly serviceKey: string,
    private readonly data: HrData = new HrData(),
    private readonly delayMs = 100,
  ) {}

  async listen(port: number, host = '127.0.0.1'): Promise<string> {
    this.httpServer = createServer(async (req, res) => {
      const send = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (req.headers[HR_SERVICE_KEY_HEADER] !== this.serviceKey) return send(401, { error: 'unauthorized' });
      const match = req.method === 'GET' ? /^\/employees\/([\w-]+)\/(leave|salary)$/.exec(req.url ?? '') : null;
      if (!match) return send(404, { error: 'not found' });

      await new Promise((resolve) => setTimeout(resolve, this.delayMs)); // like a network call
      try {
        const [, userId, kind] = match;
        const result = kind === 'leave' ? this.data.leave(userId) : this.data.salary(userId);
        return result ? send(200, result) : send(404, { error: 'no such employee' });
      } catch (error) {
        return send(500, { error: (error as Error).message });
      }
    });
    await new Promise<void>((resolve) => this.httpServer!.listen(port, host, resolve));
    return `http://${host}:${(this.httpServer.address() as AddressInfo).port}`;
  }

  async close(): Promise<void> {
    if (!this.httpServer) return;
    this.httpServer.closeAllConnections();
    await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    this.httpServer = undefined;
  }
}
