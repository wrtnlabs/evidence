import { EvidenceSwaggerAdapter } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { once } from "node:events";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  IEvidenceInventory,
  IEvidenceUnit,
  IEvidenceSourceFile,
  IEvidenceDiagnostic,
} from "@wrtnlabs/evidence";
import { join } from "node:path";

/**
 * Loads bounded remote Swagger snapshots through a controlled endpoint.
 *
 * HTTP failure and oversized responses must remain incomplete while valid
 * bounded snapshots produce a normal inventory.
 *
 * 1. Serve fresh valid documents and hold rejected HTTP and oversize bodies open.
 * 2. Analyze each remote source.
 * 3. Verify bounded success, redaction, failed decoding and interrupted reads.
 * 4. Require rejection to close every unfinished response before the test server
 *    closes.
 *
 * @evidence contracts/testing.md#behavioral-verification Serves valid, failing and oversized Swagger documents from a loopback HTTP server and asserts inventories for each remote source.
 * @evidence contracts/testing.md#independent-expectations Expected outcomes follow the bounded remote-loading contract: only the valid bounded response completes.
 * @evidence contracts/testing.md#distinguishing-cases Covers fresh valid documents, HTTP failure, declared and streamed oversize, malformed UTF-8 and interrupted reads; cancellation is observed on unfinished server responses.
 * @evidence contracts/testing.md#execution-ownership The exported test_swagger_remote is discovered by DynamicExecutor and calls maintained source in-process; its only server is an in-process node:http listener on 127.0.0.1, and it installs nothing and spawns no CLI.
 */
export async function test_swagger_remote(): Promise<void> {
  let requests: number = 0;
  const cancellations: Map<string, Promise<boolean>> = new Map();
  const server: Server = createServer(
    (request: IncomingMessage, response: ServerResponse): void => {
      const pathname: string = new URL(request.url ?? "/", "http://localhost")
        .pathname;
      if (["/failure", "/large", "/actual"].includes(pathname))
        cancellations.set(
          pathname,
          once(response, "close", { signal: AbortSignal.timeout(5000) }).then(
            (): boolean => !response.writableFinished,
            (): boolean => false,
          ),
        );
      if (request.url !== undefined && request.url.startsWith("/failure")) {
        response.statusCode = 503;
        response.statusMessage = "Unavailable";
        response.write("unavailable");
        return;
      }
      if (request.url !== undefined && request.url.startsWith("/large")) {
        response.setHeader("content-length", 16 * 1024 * 1024 + 1);
        response.write("oversized");
        return;
      }
      if (pathname === "/actual") {
        response.write(Buffer.alloc(16 * 1024 * 1024 + 1, 32));
        return;
      }
      if (pathname === "/invalid") {
        response.end(Buffer.from([255]));
        return;
      }
      if (pathname === "/interrupted") {
        response.write("openapi: 3.1.0");
        setImmediate((): void => {
          response.destroy();
        });
        return;
      }
      ++requests;
      response.setHeader("content-type", "application/yaml");
      response.end(document(requests === 1 ? "/first" : "/second"));
    },
  );
  const origin: string = await listen(server);

  try {
    const adapter: EvidenceSwaggerAdapter = new EvidenceSwaggerAdapter();
    const config: string = join(__dirname, "evidence.config.ts");
    const first: IEvidenceInventory = await adapter.load(
      config,
      `${origin}/schema?token=secret-token`,
    );
    const second: IEvidenceInventory = await adapter.load(
      config,
      `${origin}/schema?token=secret-token`,
    );

    TestValidator.equals(
      "remote source is requested for every load",
      requests,
      2,
    );
    TestValidator.equals(
      "first remote snapshot",
      first.units.map((unit: IEvidenceUnit): string => unit.name),
      ["GET:/first"],
    );
    TestValidator.equals(
      "second remote snapshot",
      second.units.map((unit: IEvidenceUnit): string => unit.name),
      ["GET:/second"],
    );
    TestValidator.equals(
      "remote source URL is sanitized",
      first.sources.map(
        (source: IEvidenceSourceFile): string => source.physicalPath,
      ),
      [`${origin}/schema?<redacted>`],
    );
    TestValidator.equals(
      "remote source secret is absent from inventory",
      JSON.stringify(first).includes("secret-token"),
      false,
    );

    const failure: IEvidenceInventory = await adapter.load(
      config,
      `${origin}/failure?token=secret-token`,
    );
    TestValidator.equals("HTTP failure is incomplete", failure.complete, false);
    TestValidator.predicate(
      "HTTP status is visible",
      failure.diagnostics.some((diagnostic: IEvidenceDiagnostic): boolean =>
        diagnostic.message.includes("HTTP 503 Unavailable"),
      ),
    );
    TestValidator.equals(
      "failure URL secret is redacted",
      JSON.stringify(failure).includes("secret-token"),
      false,
    );

    TestValidator.equals(
      "HTTP failure cancels unfinished body",
      await cancellations.get("/failure"),
      true,
    );

    const oversized: IEvidenceInventory = await adapter.load(
      config,
      `${origin}/large`,
    );
    TestValidator.equals(
      "declared oversized response is incomplete",
      oversized.complete,
      false,
    );
    TestValidator.predicate(
      "remote byte limit is visible",
      oversized.diagnostics.some((diagnostic: IEvidenceDiagnostic): boolean =>
        diagnostic.message.includes("16777216 byte limit"),
      ),
    );
    TestValidator.equals(
      "declared oversize cancels unfinished body",
      await cancellations.get("/large"),
      true,
    );
    const actual: IEvidenceInventory = await adapter.load(
      config,
      `${origin}/actual`,
    );
    TestValidator.equals(
      "streamed oversize is incomplete",
      actual.complete,
      false,
    );
    TestValidator.predicate(
      "streamed byte limit is visible",
      actual.diagnostics.some((diagnostic: IEvidenceDiagnostic): boolean =>
        diagnostic.message.includes("16777216 byte limit"),
      ),
    );
    TestValidator.equals(
      "streamed oversize cancels unfinished body",
      await cancellations.get("/actual"),
      true,
    );
    for (const pathname of ["/invalid", "/interrupted"] satisfies string[]) {
      const invalid: IEvidenceInventory = await adapter.load(
        config,
        `${origin}${pathname}`,
      );
      TestValidator.equals(
        `${pathname} remains incomplete`,
        invalid.complete,
        false,
      );
    }
  } finally {
    const closed: Promise<unknown[]> = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The Swagger fixture server has no TCP address.");
  return `http://127.0.0.1:${address.port}`;
}

function document(operationPath: string): string {
  return dedent`
    openapi: 3.1.0
    info:
      title: Remote
      version: 1.0.0
    paths:
      ${operationPath}:
        get:
          responses:
            "200":
              description: Healthy
  `;
}
