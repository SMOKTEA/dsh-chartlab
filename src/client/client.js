// dsh-chartlab client bundle: registers a "图表" tab next to Chat / Trajectory.
// Hand-written in the DSH __ModuleLoader__ format (no build step).
// - ChartTab: pure chart display (composer hidden via CSS), embeds the latest
//   chart of the CURRENT session. The tab is manual — it never auto-switches the
//   user's active view away from what they are doing.
// Event-driven: it subscribes to the session's notifier and refreshes the chart
// list only when the session changes (a render_chart tool result lands) — there
// are no polling timers.
window.__ModuleLoader__.load({
  id: "dsh-chartlab",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");

    var name = "dsh-chartlab";
    var inject = ["slots", "sessions", "locale"];

    var NS = "dsh-chartlab";
    var zh = {
      "tab.label": "chartLab",
      "tab.empty": "还没有图表。让 Agent 用 dsh-chartlab 绘制图表（例如：画 xxx.csv 的图）。"
    };
    var en = {
      "tab.label": "chartLab",
      "tab.empty": "No chart yet. Ask the agent to draw a chart with dsh-chartlab (e.g. chart xxx.csv)."
    };

    function latestChartId(body) {
      return body && body.charts && body.charts.length > 0 ? body.charts[0].chartId : null;
    }

    // Per-session chart store: tracks the newest chart id of ONE conversation.
    // Refreshes only when that session's notifier fires (live events), so a
    // render_chart tool result triggers exactly one refresh — never a timer.
    function createChartStore(sessionId, getSession) {
      var latest = null;
      var listeners = [];
      var fetching = false;
      var unsubscribeSession = null;

      function emit() {
        var snapshot = listeners.slice();
        for (var i = 0; i < snapshot.length; i++) {
          try { snapshot[i](); } catch (e) { /* listener errors are contained */ }
        }
      }

      function refresh() {
        if (fetching) return;
        fetching = true;
        fetch("/dsh-chartlab/list?session=" + encodeURIComponent(sessionId))
          .then(function (r) { return r.json(); })
          .then(function (body) {
            var id = latestChartId(body);
            if (id !== latest) { latest = id; emit(); }
          })
          .catch(function () {})
          .then(function () { fetching = false; });
      }

      function attach(session) {
        if (unsubscribeSession || !session || typeof session.subscribe !== "function") return;
        unsubscribeSession = session.subscribe(function () {
          // Only a settled tool result can add a chart (render_chart output);
          // ignore unrelated session chatter so we do not fetch on every event.
          var evs = session.events;
          var last = evs && evs.length > 0 ? evs[evs.length - 1] : null;
          if (!last) return;
          if (last.type === "tool/result" || last.type === "user/message") refresh();
        });
      }

      function ensureAttached() {
        var session = null;
        if (typeof getSession === "function") {
          try { session = getSession(); } catch (e) { session = null; }
        }
        attach(session);
        refresh(); // initial baseline (charts created before this view mounted)
      }

      return {
        subscribe: function (fn) {
          listeners.push(fn);
          if (listeners.length === 1) ensureAttached();
          return function () {
            var i = listeners.indexOf(fn);
            if (i >= 0) listeners.splice(i, 1);
            if (listeners.length === 0 && unsubscribeSession) {
              unsubscribeSession();
              unsubscribeSession = null;
            }
          };
        },
        getSnapshot: function () { return latest; },
        refresh: refresh
      };
    }

    // Subscribe a component to a chart store without relying on a specific React
    // version's useSyncExternalStore.
    function useChartStore(store) {
      var state = React.useState(store.getSnapshot());
      var latest = state[0];
      var setLatest = state[1];
      React.useEffect(function () {
        var unsub = store.subscribe(function () { setLatest(store.getSnapshot()); });
        return unsub;
      }, [store]);
      return latest;
    }

    function ChartTab(props) {
      var t = props.t;
      var store = props.chartStore;
      var latest = useChartStore(store);

      React.useEffect(function () {
        // Hide the composer while this tab is active (pure chart display).
        var style = document.createElement("style");
        style.textContent = "[data-composer-seat]{display:none !important}";
        document.head.appendChild(style);
        return function () { style.remove(); };
      }, []);

      if (!latest) {
        return React.createElement(
          "div",
          { style: { padding: "24px", color: "#9aa3b2", font: "13px system-ui, sans-serif", lineHeight: "1.6" } },
          t("tab.empty")
        );
      }
      return React.createElement("iframe", {
        src: "/dsh-chartlab/view/" + latest,
        style: { width: "100%", height: "100%", border: "none", display: "block" }
      });
    }

    // When a session is deleted: drop its chart-option caches from localStorage
    // and purge its charts from the host store (both layers of the session's
    // its dsh-chartlab state), so nothing orphaned survives the conversation.
    function onSessionRemoved(sessionId) {
      fetch("/dsh-chartlab/list?session=" + encodeURIComponent(sessionId))
        .then(function (r) { return r.json(); })
        .then(function (body) {
          var charts = body && body.charts ? body.charts : [];
          for (var i = 0; i < charts.length; i++) {
            try { localStorage.removeItem("dsh-chartlab:opts:" + charts[i].chartId); } catch (e) { /* storage unavailable */ }
          }
        })
        .catch(function () {})
        .then(function () {
          fetch("/dsh-chartlab/purge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session: sessionId })
          }).catch(function () {});
        });
    }

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-chartlab: dictionaries");
      var t = ctx.locale.bind(NS);

      ctx.effect(function () {
        var list = ctx.sessions && ctx.sessions.list;
        if (!list || typeof list.subscribe !== "function" || typeof list.getSnapshot !== "function") return;
        var known = new Set(list.getSnapshot().ids || []);
        return list.subscribe(function () {
          var snap = list.getSnapshot();
          var next = new Set(snap.ids || []);
          for (var it = known.values(); ; ) {
            var step = it.next();
            if (step.done) break;
            var id = step.value;
            if (!next.has(id)) onSessionRemoved(id);
          }
          known = next;
        });
      }, "dsh-chartlab: session cleanup");

      ctx.slots.inject("conversation.view", function () {
        return ctx.slots.register({
          name: "conversation.view",
          id: "chart",
          order: 20,
          locale: NS,
          label: function () { return t("tab.label"); },
          inject: function (sessionId) {
            var store = createChartStore(sessionId, function () {
              try {
                var binding = ctx.sessions.binding(sessionId);
                return binding && binding.session ? binding.session : null;
              } catch (e) { return null; }
            });
            return { sessionId: sessionId, chartStore: store, t: t };
          }
        }, ChartTab);
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
