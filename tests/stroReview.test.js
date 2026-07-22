const assert = require("assert");

const dbPath = require.resolve("../config/db");
const controllerPath = require.resolve("../controllers/stroControllers");

const calls = [];
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    promise() {
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          return [{ affectedRows: 1 }];
        },
      };
    },
  },
};

delete require.cache[controllerPath];
const { reviewDraft } = require("../controllers/stroControllers");

function response() {
  return {
    statusCode: 200,
    body: null,
    redirectPath: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    redirect(path) {
      this.redirectPath = path;
      return this;
    },
  };
}

(async () => {
  const approved = response();
  await reviewDraft({
    params: { strId: "17" },
    body: { decision: "approve", stro_feedback: "" },
    user: { id: 42, role: "stro" },
    session: { user: { userId: 1 } },
  }, approved);

  assert.strictEqual(approved.redirectPath, "/stro/drafts/17?reviewed=1");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].values[1], 42, "reviewer must come from req.user.id");

  const unauthenticated = response();
  await reviewDraft({
    params: { strId: "18" },
    body: { decision: "approve", stro_feedback: "" },
    user: {},
    session: { user: { userId: 1 } },
  }, unauthenticated);

  assert.strictEqual(unauthenticated.statusCode, 401);
  assert.strictEqual(calls.length, 1, "invalid JWT user ID must not update the draft");

  console.log("2 STRO reviewer attribution tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
