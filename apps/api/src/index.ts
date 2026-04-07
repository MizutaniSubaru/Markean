import { Hono } from "hono";
import type { Env } from "./env";
import { bootstrapRoutes } from "./routes/bootstrap";
import { devSessionRoutes } from "./routes/dev-session";
import { healthRoutes } from "./routes/health";
import { folderRoutes } from "./routes/folders";
import { noteRoutes } from "./routes/notes";
import { syncRoutes } from "./routes/sync";
export { SyncCoordinator } from "./durable/SyncCoordinator";

const app = new Hono<{ Bindings: Env }>();

app.route("/", healthRoutes);
app.route("/", devSessionRoutes);
app.route("/", bootstrapRoutes);
app.route("/", folderRoutes);
app.route("/", noteRoutes);
app.route("/", syncRoutes);

export default app;
