import API from "./api";

interface L10NLookup {
  [key: string]: string | boolean | undefined;
}

export interface L10NParams {
  [key: string]: string | number | undefined;
}

export const l10nStrings: L10NLookup = {};
let hasInit = false;

const initL10N = async () => {
  if (hasInit) {
    return;
  }
  const data = await API.l10n.getL10NStrings();
  for (const key in data) {
    l10nStrings[key] = data[key];
  }
  hasInit = true;
};

export const replaceParams = (string: string, params: L10NParams) => {
  let outputString = string;
  Object.keys(params).forEach((param) => {
    const pattern = new RegExp(`{${param}}`, "g");
    const paramValue = String(params[param] || "");
    outputString = outputString.replace(pattern, paramValue);
  });
  return outputString;
};

const l10n = (key: string, params?: L10NParams): string => {
  const l10nString = l10nStrings[key] || key;
  if (typeof l10nString === "string") {
    if (params) {
      return replaceParams(l10nString, params);
    }
    return l10nString;
  }
  return String(l10nString);
};

export default l10n;
export { initL10N };
