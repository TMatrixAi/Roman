import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Default express.json() limit (100kb) is too small for a base64-encoded screenshot upload
// (POST /matchups/from-screenshot) -- raised globally rather than per-route since Express body
// parsing happens before routing.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// Task #143: signs the admin-session cookie set by POST /api/auth/login so `req.signedCookies`
// is available to `requireAdmin`. Reuses SESSION_SECRET rather than introducing a second secret.
app.use(cookieParser(process.env.SESSION_SECRET));

// Without this, a malformed body or an over-limit upload (e.g. too-large screenshot on
// POST /matchups/from-screenshot) falls through to Express's default handler, which returns an
// HTML page with a raw stack trace instead of the clean JSON error shape every route in this API
// uses -- and it leaks internal file paths in the process.
const bodyParserErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err && typeof err === "object" && "type" in err && "status" in err) {
    const status = typeof err.status === "number" ? err.status : 400;
    res.status(status).json({ error: "Invalid request body", detail: (err as Error).message });
    return;
  }
  next(err);
};
app.use(bodyParserErrorHandler);

app.use("/api", router);

export default app;
