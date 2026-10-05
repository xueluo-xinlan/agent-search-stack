import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { createServer, startHttpServer, startStdioServer } from "./server.js";

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (err) {
    console.error(`[gateway] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const isStdio = process.argv.includes("--stdio") || process.env.GATEWAY_TRANSPORT === "stdio";
  const config = loadConfigOrExit();

  // stdio 传输必须保证 stdout 100% 留给 JSON-RPC 协议消息，所有日志统一走 stderr
  const logger = new Logger(config.logLevel, config.logFile, isStdio);
  logger.info(
    `config loaded: mode=${isStdio ? "stdio" : "http"} host=${config.host} port=${config.port} searxng=${config.searxngUrl} flaresolverr=${config.flaresolverrUrl} fallback=${config.searchFallback}`,
  );

  try {
    if (isStdio) {
      await startStdioServer({ config, logger }, createServer);
      logger.info("gateway ready in stdio mode (MCP client connected)");

      const shutdown = async (signal: string) => {
        logger.info(`received ${signal}, shutting down...`);
        logger.close();
        process.exit(0);
      };

      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));
    } else {
      const http = await startHttpServer({ config, logger }, createServer);

      const shutdown = async (signal: string) => {
        logger.info(`received ${signal}, shutting down...`);
        try {
          await http.close();
        } catch (err) {
          logger.error(`error closing http server: ${String(err)}`);
        }
        logger.close();
        process.exit(0);
      };

      process.on("SIGTERM", () => void shutdown("SIGTERM"));
      process.on("SIGINT", () => void shutdown("SIGINT"));
      logger.info(`gateway ready at ${http.url}`);
    }

    process.on("uncaughtException", (err) => {
      logger.error(`uncaught exception, exiting: ${err.stack ?? String(err)}`);
      logger.close();
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      logger.error(`unhandled rejection: ${String(reason)}`);
    });
  } catch (err) {
    logger.error(`startup failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    logger.close();
    process.exit(1);
  }
}

void main();
