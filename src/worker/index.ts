import "dotenv/config";
import { startScheduler } from "@/lib/scheduler";

// Poller entry point. In the Docker image the container entrypoint runs this in
// the background alongside the web server (see docker-entrypoint.sh). It can
// also be run as its own container/process; if you do that, set
// RUN_SCHEDULER=false on the web container to avoid double-scheduling.
console.log("DiALERT scheduler starting…");
startScheduler().catch((err) => {
  console.error("Worker fatal error:", err);
  process.exit(1);
});
