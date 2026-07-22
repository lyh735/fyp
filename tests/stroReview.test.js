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

          if (sql.includes("SELECT alert_id FROM str_reports")) {
            return [[{ alert_id: Number(values[0]) + 1000 }]];
          }

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
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(calls[1].values[1], 42, "reviewer must come from req.user.id");
  assert.match(
    calls[1].sql,
    /WHEN \? = 'feedback_required' THEN \?/,
    "approval must preserve any earlier STRO feedback"
  );
  assert.deepStrictEqual(calls[1].values, [
    "approved_by_stro",
    42,
    "approved_by_stro",
    null,
    "approved_by_stro",
    "17",
  ]);
  assert.deepStrictEqual(calls[2].values, [
    1017,
    42,
    "stro_approved",
    "approved_by_stro",
    "STR approved by STRO",
  ]);

  const returned = response();
  await reviewDraft({
    params: { strId: "18" },
    body: { decision: "send_feedback", stro_feedback: "Add source-of-funds details" },
    user: { id: 43, role: "stro" },
  }, returned);

  assert.strictEqual(returned.redirectPath, "/stro/drafts/18?reviewed=1");
  assert.strictEqual(calls.length, 6);
  assert.deepStrictEqual(calls[4].values, [
    "feedback_required",
    43,
    "feedback_required",
    "Add source-of-funds details",
    "feedback_required",
    "18",
  ]);
  assert.deepStrictEqual(calls[5].values, [
    1018,
    43,
    "stro_feedback_sent",
    "feedback_required",
    "Add source-of-funds details",
  ]);

  const unauthenticated = response();
  await reviewDraft({
    params: { strId: "19" },
    body: { decision: "approve", stro_feedback: "" },
    user: {},
    session: { user: { userId: 1 } },
  }, unauthenticated);

  assert.strictEqual(unauthenticated.statusCode, 401);
  assert.strictEqual(calls.length, 6, "invalid JWT user ID must not update the draft");

  console.log("3 STRO review and audit-trail tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
