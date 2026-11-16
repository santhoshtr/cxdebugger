import { getJSON, postForJSON } from "./http.js";

const form = document.getElementById("template-form");
const status = document.getElementById("status");
const summary = document.getElementById("summary");
const filters = document.getElementById("filters");
const results = document.getElementById("results");

// Worst first
const STATUS_ORDER = ["no-target", "not-adapted", "partial", "adapted"];
const STATUS_LABEL = {
  "no-target": "No target template",
  "not-adapted": "Not adapted",
  partial: "Partial: mandatory params missing",
  adapted: "Adapted",
};

const normalize = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s+_-]+/g, "");

function h(tag, { dataset = {}, ...props } = {}, ...children) {
  const element = Object.assign(document.createElement(tag), props);
  Object.assign(element.dataset, dataset);
  element.append(
    ...children.flat().filter((child) => child !== null && child !== undefined),
  );
  return element;
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.toggleAttribute("data-error", isError);
}

/**
 * Find the transclusion elements of the page. Each element is cloned without
 * its children, so that nested transclusions are not adapted twice.
 *
 * @param {Document} doc
 * @return {Element[]}
 */
function getTransclusions(doc) {
  return [...doc.querySelectorAll('[typeof~="mw:Transclusion"][data-mw]')].map(
    (element, i) => {
      const clone = element.cloneNode(false);
      clone.id = `tad-${i}`;
      return clone;
    },
  );
}

/**
 * Infer the source to target param mapping. cxserver does not return the mapping,
 * but adaptation keeps the param values, so the values identify the mapping.
 *
 * @param {Object} sourceParams
 * @param {Object} targetParams
 * @return {Object} source param name -> {target} or {candidates}
 */
function inferMapping(sourceParams, targetParams) {
  const unclaimed = new Map(
    Object.entries(targetParams).map(([name, value]) => [name, value.wt]),
  );
  const mapping = {};
  for (const [name, { wt }] of Object.entries(sourceParams)) {
    if (unclaimed.get(name) === wt) {
      mapping[name] = { target: name };
      unclaimed.delete(name);
    }
  }
  for (const [name, { wt }] of Object.entries(sourceParams)) {
    if (mapping[name]) {
      continue;
    }
    const candidates = [...unclaimed]
      .filter(([, value]) => value === wt)
      .map(([target]) => target);
    if (candidates.length === 1) {
      mapping[name] = { target: candidates[0] };
      unclaimed.delete(candidates[0]);
    } else if (candidates.length > 1) {
      mapping[name] = { candidates };
    }
  }
  return mapping;
}

function instanceStatus(dataCX) {
  if (dataCX?.targetExists === false) {
    return "no-target";
  }
  if (!dataCX?.adapted) {
    return "not-adapted";
  }
  return dataCX.partial ? "partial" : "adapted";
}

/**
 * Collect template instances from the source and adapted transclusions.
 *
 * @param {Element[]} sources
 * @param {Document} adaptedDoc
 * @return {Object[]}
 */
function collectInstances(sources, adaptedDoc) {
  const instances = [];
  for (const source of sources) {
    const adapted = adaptedDoc.getElementById(source.id);
    const sourceMW = JSON.parse(source.getAttribute("data-mw"));
    const adaptedMW = adapted && JSON.parse(adapted.getAttribute("data-mw"));
    const dataCX =
      adapted && JSON.parse(adapted.getAttribute("data-cx") || "[]");
    sourceMW.parts.forEach((part, i) => {
      // Skip wikitext parts and parser functions like {{#invoke:…}}, which have no href.
      if (!part.template?.target.href) {
        return;
      }
      const adaptedTemplate = adaptedMW?.parts[i]?.template;
      const cx = dataCX?.[i];
      instances.push({
        source: part.template.target.href.replace(/^\.\//, ""),
        target: cx?.targetExists
          ? adaptedTemplate.target.href.replace(/^\.\//, "")
          : null,
        status: instanceStatus(cx),
        sourceParams: part.template.params || {},
        targetParams: adaptedTemplate?.params || {},
        cx,
      });
    });
  }
  return instances;
}

/**
 * Group instances by source template and aggregate the param mapping.
 *
 * @param {Object[]} instances
 * @return {Object[]}
 */
function groupInstances(instances) {
  const groups = new Map();
  for (const instance of instances) {
    const key = decodeURIComponent(instance.source).replace(/_/g, " ");
    if (!groups.has(key)) {
      groups.set(key, {
        source: key,
        sourceHref: instance.source,
        target:
          instance.target &&
          decodeURIComponent(instance.target).replace(/_/g, " "),
        targetHref: instance.target,
        instances: [],
        params: new Map(),
        usedTargets: new Set(),
        mandatory: instance.cx?.mandatoryTargetParams || [],
        optional: instance.cx?.optionalTargetParams || [],
      });
    }
    const group = groups.get(key);
    group.instances.push(instance);
    const mapping = inferMapping(instance.sourceParams, instance.targetParams);
    Object.keys(instance.targetParams).forEach((name) =>
      group.usedTargets.add(name),
    );
    for (const [name, { wt }] of Object.entries(instance.sourceParams)) {
      if (!group.params.has(name)) {
        group.params.set(name, {
          name,
          uses: 0,
          value: wt,
          targets: new Map(),
        });
      }
      const param = group.params.get(name);
      param.uses++;
      const match = mapping[name];
      const target = match
        ? match.target || `one of ${match.candidates.join(", ")}`
        : "";
      param.targets.set(target, (param.targets.get(target) || 0) + 1);
    }
  }
  for (const group of groups.values()) {
    group.status =
      STATUS_ORDER[
        Math.min(
          ...group.instances.map((instance) =>
            STATUS_ORDER.indexOf(instance.status),
          ),
        )
      ];
    group.totalParams = group.instances.reduce(
      (sum, i) => sum + Object.keys(i.sourceParams).length,
      0,
    );
    group.mappedParams = group.instances.reduce(
      (sum, i) => sum + Object.keys(i.targetParams).length,
      0,
    );
  }
  return [...groups.values()].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      b.instances.length - a.instances.length,
  );
}

function matchKind(source, target) {
  if (!target) {
    return "unmapped";
  }
  if (target.startsWith("one of ")) {
    return "ambiguous";
  }
  return normalize(source) === normalize(target) ? "same name" : "renamed";
}

function renderParams(group) {
  const rows = [...group.params.values()].map((param) => {
    // Most frequent target first. A param can map differently across instances.
    const targets = [...param.targets].sort((a, b) => b[1] - a[1]);
    const [target] = targets[0];
    const kind = matchKind(param.name, target);
    const targetText =
      targets.length > 1
        ? targets.map(([t, n]) => `${t || "✗"} (${n})`).join(", ")
        : target || "✗";
    return h(
      "tr",
      { dataset: { match: kind.replace(" ", "-") } },
      h("td", {}, param.name),
      h("td", {}, String(param.uses)),
      h("td", { title: param.value }, param.value),
      h("td", {}, targetText),
      h("td", {}, kind),
    );
  });
  const unfilledMandatory = group.mandatory.filter(
    (name) => !group.usedTargets.has(name),
  );
  const unusedOptional = group.optional.filter(
    (name) => !group.usedTargets.has(name),
  );
  return [
    h(
      "div",
      {
        role: "region",
        tabIndex: 0,
        ariaLabel: `Parameters of ${group.source}`,
      },
      h(
        "table",
        {},
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            ["Source param", "Uses", "Value", "Target param", "Match"].map(
              (label) => h("th", { scope: "col" }, label),
            ),
          ),
        ),
        h("tbody", {}, rows),
      ),
    ),
    unfilledMandatory.length
      ? h(
          "p",
          {},
          h("b", {}, "Mandatory target params not filled: "),
          unfilledMandatory.join(", "),
        )
      : null,
    unusedOptional.length
      ? h(
          "p",
          {},
          h("b", {}, "Optional target params not used: "),
          unusedOptional.join(", "),
        )
      : null,
  ];
}

function wikiLink(language, href, text) {
  return h(
    "a",
    {
      href: `https://${language}.wikipedia.org/wiki/${href}`,
      target: "_blank",
    },
    text,
  );
}

function renderGroup(group, from, to) {
  const details = h(
    "details",
    { dataset: { status: group.status, template: group.source.toLowerCase() } },
    h(
      "summary",
      {},
      h("strong", {}, group.source, " → ", group.target || "(none)"),
      h("span", {}, `×${group.instances.length}`),
      group.target
        ? h("span", {}, `${group.mappedParams}/${group.totalParams} params`)
        : null,
      h("span", {}, STATUS_LABEL[group.status]),
    ),
  );
  // Build the param table only when opened. Pages can have hundreds of templates.
  details.addEventListener("toggle", () => {
    if (!details.open || details.querySelector("div")) {
      return;
    }
    details.append(
      h(
        "div",
        {},
        h(
          "p",
          {},
          wikiLink(from, group.sourceHref, `${from}: ${group.source}`),
          group.target
            ? [" · ", wikiLink(to, group.targetHref, `${to}: ${group.target}`)]
            : null,
        ),
        group.target
          ? renderParams(group)
          : h("p", {}, `No equivalent template on ${to} wiki.`),
      ),
    );
  });
  return details;
}

function renderSummary(groups, instances) {
  const count = (state) => instances.filter((i) => i.status === state).length;
  const withTarget = instances.filter((i) => i.status !== "no-target");
  const total = withTarget.reduce(
    (sum, i) => sum + Object.keys(i.sourceParams).length,
    0,
  );
  const mapped = withTarget.reduce(
    (sum, i) => sum + Object.keys(i.targetParams).length,
    0,
  );
  const renamed = withTarget.reduce(
    (sum, i) =>
      sum +
      Object.entries(inferMapping(i.sourceParams, i.targetParams)).filter(
        ([source, { target }]) =>
          target && normalize(source) !== normalize(target),
      ).length,
    0,
  );
  const stats = [
    ["Template calls", instances.length],
    ["Distinct Templates", groups.length],
    ["Adapted", count("adapted")],
    ["Partial", count("partial")],
    ["Not adapted", count("not-adapted")],
    ["No target", count("no-target")],
    [
      "Params mapped",
      `${mapped}/${total}${total ? ` (${Math.round((100 * mapped) / total)}%)` : ""}`,
    ],
    ["Renamed params", renamed],
  ];
  summary.replaceChildren(
    ...stats.map(([label, value]) =>
      h("div", {}, h("dt", {}, label), h("dd", {}, String(value))),
    ),
  );
}

function applyFilters() {
  const state = filters.querySelector('[name="status"]:checked').value;
  const search = filters
    .querySelector('[name="search"]')
    .value.trim()
    .toLowerCase();
  for (const details of results.children) {
    details.hidden =
      (state && details.dataset.status !== state) ||
      (search && !details.dataset.template.includes(search));
  }
}

async function run({ api, from, to, title }) {
  api = api.replace(/\/+$/, "");
  summary.hidden = filters.hidden = true;
  results.replaceChildren();
  setStatus(`Fetching ${from}:${title}…`);
  const page = await getJSON(
    `${api}/v2/page/${from}/${to}/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  );
  const sources = getTransclusions(
    new DOMParser().parseFromString(page.segmentedContent, "text/html"),
  );
  if (!sources.length) {
    setStatus("No templates found on the page.");
    return;
  }
  setStatus(`Adapting ${sources.length} transclusions to ${to}…`);
  const started = performance.now();
  const { contents } = await postForJSON(`${api}/v2/translate/${from}/${to}`, {
    html: `<div>${sources.map((s) => s.outerHTML).join("")}</div>`,
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const instances = collectInstances(
    sources,
    new DOMParser().parseFromString(contents, "text/html"),
  );
  const groups = groupInstances(instances);
  renderSummary(groups, instances);
  results.replaceChildren(
    ...groups.map((group) => renderGroup(group, from, to)),
  );
  summary.hidden = filters.hidden = false;
  applyFilters();
  setStatus(
    `${from}:${title} → ${to}, revision ${page.revision}. Adaptation took ${seconds}s.`,
  );
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const params = Object.fromEntries(new FormData(form));
  history.replaceState(null, "", `?${new URLSearchParams(params)}`);
  form.querySelector("button").disabled = true;
  try {
    await run(params);
  } catch (error) {
    setStatus(`Failed: ${error.message}`, true);
  } finally {
    form.querySelector("button").disabled = false;
  }
});
filters.addEventListener("input", applyFilters);

// Prefill from the URL, and run if the URL has a title. Links can be shared.
const query = new URLSearchParams(location.search);
for (const [name, value] of query) {
  if (form.elements[name]) {
    form.elements[name].value = value;
  }
}
if (query.has("title")) {
  form.requestSubmit();
}
