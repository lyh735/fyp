const assert = require("assert");

const dbPath = require.resolve("../config/db");
const controllerPath = require.resolve("../controllers/stroController");

let queryHandler = null;
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query(sql, values, callback) {
      queryHandler(sql, values, callback);
    },
  },
};

delete require.cache[controllerPath];
const {
  getNotificationSummary,
  getStroOutcomes,
} = require("../controllers/stroController");

function invoke(user, action = getNotificationSummary) {
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
      },
    };

    action({ user }, response);
  });
}

(async () => {
  queryHandler = (sql, values, callback) => {
    assert.match(sql, /pending_stro_review/);
    assert.deepStrictEqual(values, []);
    callback(null, [{ notification_count: "4" }]);
  };
  const stro = await invoke({ id: 8, role: "stro" });
  assert.deepStrictEqual(stro, {
    status: 200,
    body: { role: "stro", type: "pending_stro_review", count: 4 },
  });

  queryHandler = (sql, values, callback) => {
    assert.match(sql, /feedback_required/);
    assert.match(sql, /generated_by = \?/);
    assert.deepStrictEqual(values, [23]);
    callback(null, [{ notification_count: "2" }]);
  };
  const analyst = await invoke({ id: 23, role: "analyst" });
  assert.deepStrictEqual(analyst, {
    status: 200,
    body: { role: "analyst", type: "feedback_required", count: 2 },
  });

  const invalidAnalyst = await invoke({ id: 0, role: "analyst" });
  assert.strictEqual(invalidAnalyst.status, 401);

  const forbidden = await invoke({ id: 1, role: "admin" });
  assert.strictEqual(forbidden.status, 403);

  queryHandler = (sql, values, callback) => {
    assert.match(sql, /latest_str\.generated_by = \?/);
    assert.deepStrictEqual(values, [23]);
    callback(null, [{
      id: 9,
      alert_id: 9,
      str_id: 14,
      str_reference_number: "STR-14",
      str_status: "pending_stro_review",
    }]);
  };
  const outcomes = await invoke({ id: 23, role: "analyst" }, getStroOutcomes);
  assert.strictEqual(outcomes.status, 200);
  assert.strictEqual(outcomes.body.length, 1);
  assert.strictEqual(outcomes.body[0].str_id, 14);

  console.log("5 STR notification and ownership tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
