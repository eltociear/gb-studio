const l10n = require("../helpers/l10n").default;

const id = "EVENT_IF_EXPRESSION";

const fields = [
  {
    key: "expression",
    type: "matharea",
    rows: 5,
    placeholder: "e.g. $health >= 0...",
    defaultValue: "",
  },
  {
    key: "true",
    type: "events",
  },
  {
    key: "__collapseElse",
    label: l10n("FIELD_ELSE"),
    type: "collapsable",
    defaultValue: true,
    conditions: [
      {
        key: "__disableElse",
        ne: true,
      },
    ],
  },
  {
    key: "false",
    conditions: [
      {
        key: "__collapseElse",
        ne: true,
      },
      {
        key: "__disableElse",
        ne: true,
      },
    ],
    type: "events",
  },
];

const compile = (input, helpers) => {
  const { ifExpression } = helpers;
  const truePath = input.true;
  const falsePath = input.__disableElse ? [] : input.false;
  ifExpression(input.expression || "0", truePath, falsePath);
};

module.exports = {
  id,
  fields,
  compile,
};