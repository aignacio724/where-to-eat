// Must stay the first import. ES module imports all run before this file's
// body, and rateLimit.ts reads RATE_LIMIT_* from the environment as it loads,
// so a dotenv.config() call down here would come too late.
import "dotenv/config";

import { app } from "./app.ts";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
