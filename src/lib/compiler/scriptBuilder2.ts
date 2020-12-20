import {
  getActor,
  getSpriteIndex,
  getMusicIndex,
  compileConditional,
  getSpriteOffset,
  getSprite,
  getSpriteSceneIndex,
} from "../events/helpers";
import {
  dirDec,
  operatorDec,
  inputDec,
  moveSpeedDec,
  animSpeedDec,
  collisionMaskDec,
  paletteMaskDec,
  collisionGroupDec,
  actorRelativeDec,
  moveTypeDec,
  heightDec,
  actorFramesPerDir,
  spriteTypeDec,
  textSpeedDec,
} from "./helpers";
import { hi, lo } from "../helpers/8bit";
import trimlines from "../helpers/trimlines";
import { SPRITE_TYPE_ACTOR } from "../../consts";
import { is16BitCType } from "../helpers/engineFields";
import {
  globalVariableName,
  localVariableName,
  nextVariable,
  tempVariableName,
} from "../helpers/variables";
import {
  ScriptEvent,
  Variable,
} from "../../store/features/entities/entitiesTypes";
import { Dictionary } from "@reduxjs/toolkit";
import { spriteSheetSymbol } from "./compileData2";

type ScriptOutput = string[];

interface ScriptBuilderEntity {
  id: string;
}

interface ScriptBuilderScene {
  id: string;
  actors: ScriptBuilderEntity[];
  triggers: ScriptBuilderEntity[];
}

type ScriptBuilderEntityType = "scene" | "actor" | "trigger";

type ScriptBuilderStackVariable = string | number;

interface ScriptBuilderOptions {
  scene: ScriptBuilderScene;
  sceneIndex: number;
  entityIndex: number;
  entityType: ScriptBuilderEntityType;
  variables: string[];
  variablesLookup: VariablesLookup;
  variableAliasLookup: Dictionary<string>;
  sprites: ScriptBuilderEntity[];
  entity?: ScriptBuilderEntity;
  compileEvents: (self: ScriptBuilder, events: ScriptEvent[]) => void;
}

type ScriptBuilderMoveType = "horizontal" | "vertical" | "diagonal";

type ScriptBuilderComparisonOperator =
  | ".EQ"
  | ".NE"
  | ".GT"
  | ".GTE"
  | ".LT"
  | ".LTE"
  | ".AND"
  | ".OR";

type ScriptBuilderOverlayWaitFlag =
  | ".UI_WAIT_WINDOW"
  | ".UI_WAIT_TEXT"
  | ".UI_WAIT_BTN_A"
  | ".UI_WAIT_BTN_B"
  | ".UI_WAIT_BTN_ANY";

type ScriptBuilderChoiceFlag = ".UI_MENU_LAST_0" | ".UI_MENU_CANCEL_B";

type ScriptBuilderRPNOperation =
  | ".ADD"
  | ".SUB"
  | ".MUL"
  | ".DIV"
  | ".MOD"
  | ".B_AND"
  | ".B_OR"
  | ".B_XOR"
  | ".B_NOT"
  | ".ABS";

type ScriptBuilderOverlayMoveSpeed =
  | number
  | ".OVERLAY_TEXT_IN_SPEED"
  | ".OVERLAY_TEXT_OUT_SPEED";

type ScriptBuilderTextLayout =
  | 0
  | ".UI_ENABLE_MENU_ONECOL"
  | ".UI_ENABLE_MENU_TWOCOL";

type ScriptBuilderPathFunction = () => void;

type VariablesLookup = { [name: string]: Variable | undefined };

// - Helpers --------------

const getActorIndex = (actorId: string, scene: ScriptBuilderScene) => {
  return scene.actors.findIndex((a) => a.id === actorId) + 1;
};

export const getVariableIndex = (variable: string, variables: string[]) => {
  const normalisedVariable = String(variable)
    .replace(/\$/g, "")
    .replace(/^0+([0-9])/, "$1");
  let variableIndex = variables.indexOf(normalisedVariable);
  if (variableIndex === -1) {
    variables.push(normalisedVariable);
    variableIndex = variables.length - 1;
  }
  return variableIndex;
};

export const getVariableId = (
  variable: string,
  entity?: ScriptBuilderEntity
) => {
  if (isVariableLocal(variable)) {
    if (entity) {
      return `${entity.id}__${variable}`;
    }
  } else if (isVariableTemp(variable)) {
    return variable;
  }
  return String(parseInt(variable));
};

export const toVariableNumber = (variable: string) => {
  return variable.replace(/[^0-9]/g, "");
};

export const isVariableLocal = (variable: string) => {
  return ["L0", "L1", "L2", "L3", "L4", "L5"].indexOf(variable) > -1;
};

export const isVariableTemp = (variable: string) => {
  return ["T0", "T1"].indexOf(variable) > -1;
};

const toValidLabel = (label: string): string => {
  return label.replace(/[^A-Za-z0-9]/g, "_");
};

const buildOverlayWaitCondition = (flags: ScriptBuilderOverlayWaitFlag[]) => {
  return unionFlags(flags, ".UI_WAIT_NONE");
};

const unionFlags = (flags: string[], defaultValue: string = "0") => {
  if (flags.length === 0) {
    return defaultValue;
  }
  return `^/(${flags.join(" | ")})/`;
};

const toASMVar = (symbol: string) => {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "_");
};

// ------------------------

class ScriptBuilder {
  byteSize: number;
  output: ScriptOutput;
  options: ScriptBuilderOptions;
  dependencies: string[];
  nextLabel: number;
  actorIndex: number;
  stack: number[];
  stackPtr: number;
  labelStackSize: Dictionary<number>;

  constructor(
    output: ScriptOutput,
    options: Partial<ScriptBuilderOptions> & Pick<ScriptBuilderOptions, "scene">
  ) {
    this.byteSize = 0;
    this.output = output;
    this.options = {
      ...options,
      sceneIndex: options.sceneIndex || 0,
      entityIndex: options.entityIndex || 0,
      entityType: options.entityType || "scene",
      variables: options.variables || [],
      variablesLookup: options.variablesLookup || {},
      variableAliasLookup: options.variableAliasLookup || {},
      sprites: options.sprites || [],
      compileEvents: options.compileEvents || ((_self, _e) => {}),
    };
    this.dependencies = [];
    this.nextLabel = 1;
    this.actorIndex = options.entity
      ? getActorIndex(options.entity.id, options.scene)
      : 0;
    this.stack = [];
    this.stackPtr = 0;
    this.labelStackSize = {};
  }

  // --------------------------------------------------------------------------
  // Private methods

  private _addDependency = (symbol: string) => {
    const dataSymbol = `_${symbol}`;
    if (!this.dependencies.includes(dataSymbol)) {
      this.dependencies.push(dataSymbol);
    }
  };

  private _addBankedFnDependency = (symbol: string) => {
    const bankSymbol = `b_${symbol}`;
    const dataSymbol = `_${symbol}`;
    if (!this.dependencies.includes(bankSymbol)) {
      this.dependencies.push(bankSymbol);
    }
    if (!this.dependencies.includes(dataSymbol)) {
      this.dependencies.push(dataSymbol);
    }
  };

  private _addBankedDataDependency = (symbol: string) => {
    const bankSymbol = `___bank_${symbol}`;
    const dataSymbol = `_${symbol}`;
    if (!this.dependencies.includes(bankSymbol)) {
      this.dependencies.push(bankSymbol);
    }
    if (!this.dependencies.includes(dataSymbol)) {
      this.dependencies.push(dataSymbol);
    }
  };

  private _addComment = (comment: string) => {
    this.output.push(`        ; ${comment}`);
  };

  private _addCmd = (cmd: string, ...args: Array<string | number>) => {
    this.output.push(this._padCmd(cmd, args.join(", "), 8, 24));
  };

  private _prettyFormatCmd = (cmd: string, args: Array<string | number>) => {
    if (args.length > 0) {
      return `        ${cmd.padEnd(
        Math.max(24, cmd.length + 1),
        " "
      )}${args.join(", ")}`;
    } else {
      return `        ${cmd}`;
    }
  };

  private _padCmd = (
    cmd: string,
    args: string,
    nPadStart: number,
    nPadCmd: number
  ) => {
    const startPadding = "".padStart(nPadStart);
    if (args.length > 0) {
      return `${startPadding}${cmd.padEnd(
        Math.max(nPadCmd, cmd.length + 1),
        " "
      )}${args}`;
    } else {
      return `${startPadding}${cmd}`;
    }
  };

  private _assertStackNeutral = (expected: number = 0) => {
    if (this.stackPtr !== expected) {
      const diff = this.stackPtr - expected;
      if (this.stackPtr > expected) {
        throw new Error(`Script was not stack neutral! Stack grew by ${diff}`);
      } else if (this.stackPtr < expected) {
        throw new Error(
          `Script was not stack neutral! Stack shrank by ${-diff}`
        );
      }
    }
  };

  private _assertLabelStackNeutral = (label: string) => {
    if (!this.labelStackSize[label]) {
      this.labelStackSize[label] = this.stackPtr;
    } else {
      if (this.stackPtr !== this.labelStackSize[label]) {
        throw new Error(
          `Jump to label with different stack size. First call size=${this.labelStackSize[label]}, this call size=${this.stackPtr}`
        );
      }
    }
  };

  // --------------------------------------------------------------------------
  // Low Level GB Studio Assembly Operations

  _invoke = (fn: string, popNum: number, numArgs: number) => {
    this._addBankedFnDependency(fn);
    this._addCmd(
      "VM_INVOKE",
      `b_${fn}`,
      `_${fn}`,
      popNum,
      numArgs > 0 ? `.ARG${numArgs - 1}` : "0"
    );
    this.stackPtr -= popNum;
  };

  _stackPush = (value: number) => {
    this.stack[this.stackPtr++] = value;
    this._addCmd("VM_PUSH", value);
  };

  _stackPop = (num: number) => {
    this.stackPtr -= num;
    this._addCmd("VM_POP", num);
  };

  _set = (location: string | number, value: string | number) => {
    this._addCmd("VM_SET", location, value);
  };

  _setConst = (location: string | number, value: string | number) => {
    this._addCmd("VM_SET_CONST", location, value);
  };

  _setUInt8 = (cVariable: string, popNum: number) => {
    this._addDependency(cVariable);
    this.stackPtr -= popNum;
    this._addCmd("VM_SET_UINT8", `_${cVariable}`, popNum);
  };

  _setConstUInt8 = (cVariable: string, value: number) => {
    this._addDependency(cVariable);
    this._addCmd("VM_SET_CONST_UINT8", `_${cVariable}`, value);
  };

  _getUInt8 = (location: string | number, cVariable: string) => {
    this._addCmd("VM_GET_UINT8", location, `_${cVariable}`);
  };

  _string = (str: string) => {
    this._addCmd(`.asciz "${str.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`);
  };

  _dw = (...data: Array<string | number>) => {
    this._addCmd(`.dw ${data.join(", ")}`);
  };

  _label = (label: string) => {
    const _label = toValidLabel(label);
    this._assertLabelStackNeutral(_label);
    this.output.push(`${_label}$:`);
  };

  _jump = (label: string) => {
    const _label = toValidLabel(label);
    this._assertLabelStackNeutral(_label);
    this._addCmd("VM_JUMP", `${_label}$`);
  };

  _randomize = () => {
    this._addCmd("VM_RANDOMIZE");
  };

  _rand = (location: string | number, min: number, range: number) => {
    this._addCmd("VM_RAND", location, min, range);
  };

  _rpn = () => {
    const output: string[] = [];
    const stack: number[] = [];

    const rpnCmd = (cmd: string, ...args: Array<string | number>) => {
      output.push(this._padCmd(cmd, args.join(", "), 12, 12));
    };

    const rpn = {
      ref: (variable: string) => {
        rpnCmd(".R_REF ", variable);
        stack.push(0);
        return rpn;
      },
      int8: (value: number) => {
        rpnCmd(".R_INT8", value);
        stack.push(0);
        return rpn;
      },
      int16: (value: number) => {
        rpnCmd(".R_INT16", value);
        stack.push(0);
        return rpn;
      },
      operator: (op: ScriptBuilderRPNOperation) => {
        rpnCmd(".R_OPERATOR", op);
        stack.pop();
        return rpn;
      },
      stop: () => {
        rpnCmd(".R_STOP");
        this._addCmd("VM_RPN");
        output.forEach((cmd: string) => {
          this.output.push(cmd);
        });
        stack.forEach((value: number) => {
          this.stack[this.stackPtr++] = value;
        });
      },
    };

    return rpn;
  };

  _if = (
    operator: ScriptBuilderComparisonOperator,
    variableA: string | number,
    variableB: string | number,
    label: string,
    popNum: number
  ) => {
    this._addCmd(
      `VM_IF ${operator}`,
      `${variableA}, ${variableB}, ${label}$, ${popNum}`
    );
    this.stackPtr -= popNum;
  };

  _ifConst = (
    operator: ScriptBuilderComparisonOperator,
    variable: string | number,
    value: string | number,
    label: string,
    popNum: number
  ) => {
    this._addCmd(
      `VM_IF_CONST ${operator}`,
      `${variable}, ${value}, ${label}$, ${popNum}`
    );
    this.stackPtr -= popNum;
  };

  _actorMoveTo = (addr: string) => {
    this._addCmd("VM_ACTOR_MOVE_TO", addr);
  };

  _loadText = (numInputs: number) => {
    this._addCmd("VM_LOAD_TEXT", `${numInputs}`);
  };

  _loadStructuredText = (inputText: string) => {
    let text = inputText;

    const inlineVariables = (
      text.match(/(\$L[0-9]\$|\$T[0-1]\$|\$[0-9]+\$)/g) || []
    ).map((s) => s.replace(/\$/g, ""));

    const usedVariableAliases = inlineVariables.map((variable) =>
      this.getVariableAlias(variable.replace(/^0/g, ""))
    );

    // Replace speed codes
    text = text.replace(/!S([0-5])!/g, (_match, value: string) => {
      return `\\02${value}`;
    });

    inlineVariables.forEach((code) => {
      text = text.replace(`$${code}$`, "%d");
    });

    this._loadText(usedVariableAliases.length);
    if (usedVariableAliases.length > 0) {
      this._dw(...usedVariableAliases);
    }
    this._string(text);
  };

  _displayText = (avatar?: number, layout: ScriptBuilderTextLayout = 0) => {
    if (avatar) {
      const avatarSymbol = spriteSheetSymbol(avatar);
      this._addBankedDataDependency(avatarSymbol);
      this._addCmd(
        "VM_DISPLAY_TEXT",
        `___bank_${avatarSymbol}`,
        `_${avatarSymbol}`,
        layout
      );
    } else {
      this._addCmd("VM_DISPLAY_TEXT", 0, 0, layout);
    }
  };

  _choice = (variable: string | number, options: ScriptBuilderChoiceFlag[]) => {
    this._addCmd("VM_CHOICE", variable, unionFlags(options));
  };

  _overlayShow = (x: number, y: number, color: number) => {
    this._addCmd("VM_OVERLAY_SHOW", x, y, color);
  };

  _overlayHide = () => {
    this._addCmd("VM_OVERLAY_HIDE");
  };

  _overlayMoveTo = (
    x: number,
    y: number,
    speed: ScriptBuilderOverlayMoveSpeed
  ) => {
    this._addCmd("VM_OVERLAY_MOVE_TO", x, y, speed);
  };

  _overlayWait = (
    modal: boolean,
    waitFlags: ScriptBuilderOverlayWaitFlag[]
  ) => {
    this._addCmd(
      "VM_OVERLAY_WAIT",
      modal ? ".UI_MODAL" : ".UI_NONMODAL",
      buildOverlayWaitCondition(waitFlags)
    );
  };

  _inputWait = (mask: number) => {
    this._addCmd("VM_INPUT_WAIT", mask);
  };

  _stop = () => {
    this._assertStackNeutral();
    this._addComment("Stop Script");
    this._addCmd("VM_STOP");
  };

  // --------------------------------------------------------------------------
  // Actors

  actorSetActive = (id: string) => {
    const output = this.output;
    const { scene, entity } = this.options;
    const newIndex =
      id === "$self$" && entity
        ? getActorIndex(entity.id, scene)
        : getActorIndex(id, scene);
    if (newIndex !== this.actorIndex) {
      this.actorIndex = newIndex;
      this._stackPush(this.actorIndex);
      this._set("ACTOR", ".ARG0");
      this._invoke("vm_actor_activate", 1, 1);
    }
  };

  actorMoveTo = (
    x: number,
    y: number,
    useCollisions: boolean,
    moveType: ScriptBuilderMoveType
  ) => {
    const stackPtr = this.stackPtr;
    this._setConst("^/ACTOR + 1/", x);
    this._setConst("^/ACTOR + 2/", y);
    this._setConst("^/ACTOR + 3/", useCollisions ? 1 : 0);
    this._setConst("^/ACTOR + 4/", moveTypeDec(moveType));
    this._actorMoveTo("ACTOR");
    this._assertStackNeutral(stackPtr);
  };

  actorMoveRelative = (
    x: number = 0,
    y: number = 0,
    useCollisions: boolean = false,
    moveType: ScriptBuilderMoveType
  ) => {
    // const output = this.output;
    // output.push(cmd(ACTOR_MOVE_RELATIVE));
    // output.push(Math.abs(x));
    // output.push(x < 0 ? 1 : 0);
    // output.push(Math.abs(y));
    // output.push(y < 0 ? 1 : 0);
    // output.push(useCollisions ? 1 : 0);
    // output.push(moveTypeDec(moveType));
  };

  // --------------------------------------------------------------------------
  // Timing

  nextFrameAwait = () => {
    const stackPtr = this.stackPtr;
    this._stackPush(1);
    this._invoke("wait_frames", 1, 1);
    this._assertStackNeutral(stackPtr);
  };

  wait = (frames: number) => {
    const stackPtr = this.stackPtr;
    this._stackPush(frames);
    this._invoke("wait_frames", 1, 1);
    this._assertStackNeutral(stackPtr);
  };

  // --------------------------------------------------------------------------
  // UI

  textDialogue = (inputText: string | string[] = " ", avatarId?: string) => {
    const { sprites } = this.options;
    const input: string[] = Array.isArray(inputText) ? inputText : [inputText];
    const maxPerLine = avatarId ? 16 : 18;

    const trimmedInput = input.map((textBlock) => {
      let text = textBlock;
      text = trimlines(textBlock, maxPerLine);
      const lineCount = text.split("\n").length;
      if (lineCount === 1) {
        text += "\n";
      }
      return text;
    });

    const initialNumLines = trimmedInput.map(
      (textBlock) => textBlock.split("\n").length
    );

    const maxNumLines = Math.max.apply(null, initialNumLines);
    const textBoxY = 18 - maxNumLines - 2;

    // Add additional newlines so all textboxes in a
    // sequence have the same height
    const paddedInput = trimmedInput.map((textBlock) => {
      let text = textBlock;
      const numLines = text.split("\n").length;
      if (numLines < maxNumLines) {
        text += new Array(maxNumLines - numLines + 1).join("\n");
      }
      return text;
    });

    this._addComment("Text Dialogue");
    paddedInput.forEach((text, textIndex) => {
      this._loadStructuredText(text);
      if (textIndex === 0) {
        this._overlayMoveTo(0, textBoxY, ".OVERLAY_TEXT_IN_SPEED");
      }
      if (avatarId) {
        const avatarIndex = getSpriteIndex(avatarId, sprites);
        this._displayText(avatarIndex);
      } else {
        this._displayText();
      }
      this._overlayWait(true, [
        ".UI_WAIT_WINDOW",
        ".UI_WAIT_TEXT",
        ".UI_WAIT_BTN_A",
      ]);
      if (textIndex === paddedInput.length - 1) {
        this._overlayMoveTo(0, 18, ".OVERLAY_TEXT_OUT_SPEED");
        this._overlayWait(true, [".UI_WAIT_WINDOW", ".UI_WAIT_TEXT"]);
      }
    });
  };

  textSetAnimSpeed = (
    speedIn: number,
    speedOut: number,
    textSpeed: number = 1,
    allowFastForward: boolean = true
  ) => {
    this._addComment("Text Set Animation Speed");
    this._setConstUInt8("text_ff_joypad", allowFastForward ? 1 : 0);
    this._setConstUInt8("text_draw_speed", textSpeedDec(textSpeed));
    this._setConstUInt8("text_out_speed", speedOut);
    this._setConstUInt8("text_in_speed", speedIn);
  };

  textChoice = (
    setVariable: string,
    args: { trueText: string; falseText: string }
  ) => {
    const trueText = trimlines(args.trueText || "", 17, 1) || "Choice A";
    const falseText = trimlines(args.falseText || "", 17, 1) || "Choice B";
    const choiceText = `\\020${trueText}\n${falseText}`;
    const variableAlias = this.getVariableAlias(setVariable);
    const numLines = choiceText.split("\n").length;

    this._addComment("Text Multiple Choice");
    this._loadStructuredText(choiceText);
    this._overlayMoveTo(0, 18 - numLines - 2, ".OVERLAY_TEXT_IN_SPEED");
    this._displayText(undefined, ".UI_ENABLE_MENU_ONECOL");
    this._overlayWait(true, [".UI_WAIT_WINDOW", ".UI_WAIT_TEXT"]);
    this._choice(variableAlias, [".UI_MENU_LAST_0", ".UI_MENU_CANCEL_B"]);
    this._overlayMoveTo(0, 18, ".OVERLAY_TEXT_OUT_SPEED");
    this._overlayWait(true, [".UI_WAIT_WINDOW", ".UI_WAIT_TEXT"]);
  };

  textMenu = (
    setVariable: string,
    options: string[],
    layout: string = "menu",
    cancelOnLastOption: boolean = false,
    cancelOnB: boolean = false
  ) => {
    const variableAlias = this.getVariableAlias(setVariable);
    const menuText =
      "\\020" +
      options
        .map(
          (option, index) =>
            trimlines(option || "", 6, 1) || `Item ${index + 1}`
        )
        .join("\n");
    const numLines = menuText.split("\n").length;
    const height = layout === "menu" ? numLines : Math.min(numLines, 4);
    const x = layout === "menu" ? 10 : 0;
    const layoutFlag =
      layout === "menu" ? ".UI_ENABLE_MENU_ONECOL" : ".UI_ENABLE_MENU_TWOCOL";
    const choiceFlags: ScriptBuilderChoiceFlag[] = [];
    if (cancelOnLastOption) {
      choiceFlags.push(".UI_MENU_LAST_0");
    }
    if (cancelOnB) {
      choiceFlags.push(".UI_MENU_CANCEL_B");
    }

    this._addComment("Text Menu");
    this._loadStructuredText(menuText);
    if (layout === "menu") {
      this._overlayMoveTo(10, 18, 0);
    }
    this._overlayMoveTo(x, 18 - height - 2, ".OVERLAY_TEXT_IN_SPEED");
    this._displayText(undefined, layoutFlag);
    this._overlayWait(true, [".UI_WAIT_WINDOW", ".UI_WAIT_TEXT"]);
    this._choice(variableAlias, choiceFlags);
    this._overlayMoveTo(x, 18, ".OVERLAY_TEXT_OUT_SPEED");
    this._overlayWait(true, [".UI_WAIT_WINDOW", ".UI_WAIT_TEXT"]);
    if (layout === "menu") {
      this._overlayMoveTo(0, 18, 0);
    }
  };

  overlayShow = (color = "white", x = 0, y = 0) => {
    this._addComment("Overlay Show");
    this._overlayShow(x, y, color === "white" ? 1 : 0);
  };

  overlayHide = () => {
    this._addComment("Overlay Hide");
    this._overlayHide();
  };

  overlayMoveTo = (x = 0, y = 18, speed = 0) => {
    this._addComment("Overlay Move To");
    this._overlayMoveTo(x, y, speed);
    this._overlayWait(true, [".UI_WAIT_WINDOW"]);
  };

  // --------------------------------------------------------------------------
  // Input

  inputAwait = (input: string[]) => {
    this._addComment("Wait For Input");
    this._inputWait(inputDec(input));
  };

  // --------------------------------------------------------------------------
  // Scenes

  sceneSwitch = (
    sceneId: string,
    x: number = 0,
    y: number = 0,
    direction: string = "down",
    fadeSpeed: number = 2
  ) => {
    // const output = this.output;
    // const { scenes } = this.options;
    // const sceneIndex = scenes.findIndex((s) => s.id === sceneId);
    // if (sceneIndex > -1) {
    //   output.push(cmd(SWITCH_SCENE));
    //   output.push(hi(sceneIndex));
    //   output.push(lo(sceneIndex));
    //   output.push(x);
    //   output.push(y);
    //   output.push(dirDec(direction));
    //   output.push(fadeSpeed);
    //   this.scriptEnd();
    // }
  };

  // --------------------------------------------------------------------------
  // Variables

  getVariableAlias = (variable = "0"): string => {
    if (variable.startsWith(".")) {
      return variable;
    }

    const {
      entity,
      sceneIndex,
      entityIndex,
      entityType,
      variablesLookup,
      variableAliasLookup,
    } = this.options;
    const id = getVariableId(variable, entity);

    // If already got an alias use that
    const existingAlias = variableAliasLookup[id];
    if (existingAlias) {
      return existingAlias;
    }

    let name = "";
    if (entity && isVariableLocal(variable)) {
      const num = toVariableNumber(variable);
      const localName = localVariableName(num, entity.id, variablesLookup);
      if (entityType === "scene") {
        name = `S${sceneIndex}_${localName}`;
      } else if (entityType === "actor") {
        name = `S${sceneIndex}A${entityIndex}_${localName}`;
      } else if (entityType === "trigger") {
        name = `S${sceneIndex}T${entityIndex}_${localName}`;
      }
    } else if (isVariableTemp(variable)) {
      const num = toVariableNumber(variable);
      name = tempVariableName(num);
    } else {
      const num = toVariableNumber(variable);
      name = globalVariableName(num, variablesLookup);
    }

    let alias = "VAR_" + toASMVar(name);
    let newAlias = alias;
    let counter = 1;

    // Make sure new alias is unique
    const aliases = Object.values(variableAliasLookup) as string[];
    while (aliases.includes(newAlias)) {
      newAlias = `${alias}_${counter}`;
      counter++;
    }

    // New Alias is now unique
    variableAliasLookup[id] = newAlias;

    return newAlias;
  };

  variableInc = (variable: string) => {
    const variableAlias = this.getVariableAlias(variable);
    this._addComment("Variable Increment By 1");
    this._rpn() //
      .ref(variableAlias)
      .int8(1)
      .operator(".ADD")
      .stop();
    this._set(variableAlias, ".ARG0");
    this._stackPop(1);
  };

  variableDec = (variable: string) => {
    const variableAlias = this.getVariableAlias(variable);
    this._addComment("Variable Decrement By 1");
    this._rpn() //
      .ref(variableAlias)
      .int8(1)
      .operator(".SUB")
      .stop();
    this._set(variableAlias, ".ARG0");
    this._stackPop(1);
  };

  variableSetToTrue = (variable: string) => {
    const variableAlias = this.getVariableAlias(variable);
    this._addComment("Variable Set To True");
    this._setConst(variableAlias, 1);
  };

  variableSetToFalse = (variable: string) => {
    const variableAlias = this.getVariableAlias(variable);
    this._addComment("Variable Set To False");
    this._setConst(variableAlias, 0);
  };

  variableSetToValue = (variable: string, value: number) => {
    const variableAlias = this.getVariableAlias(variable);
    this._addComment("Variable Set To Value");
    this._setConst(variableAlias, value);
  };

  variableCopy = (setVariable: string, otherVariable: string) => {
    const variableAliasA = this.getVariableAlias(setVariable);
    const variableAliasB = this.getVariableAlias(otherVariable);
    this._addComment("Variable Copy");
    this._set(variableAliasA, variableAliasB);
  };

  variableSetToRandom = (variable: string, min: number, range: number) => {
    const variableAlias = this.getVariableAlias(variable);
    this._addComment("Variable Set To Random");
    this._randomize();
    this._rand(variableAlias, min, range);
  };

  variablesOperation = (
    setVariable: string,
    operation: ScriptBuilderRPNOperation,
    otherVariable: string,
    clamp: boolean
  ) => {
    const variableAliasA = this.getVariableAlias(setVariable);
    const variableAliasB = this.getVariableAlias(otherVariable);
    const clampLabel = clamp ? this.getNextLabel() : "";

    this._addComment(`Variables ${operation}`);
    this._rpn() //
      .ref(variableAliasA)
      .ref(variableAliasB)
      .operator(operation)
      .stop();

    if (clamp) {
      if (operation === ".ADD") {
        this._stackPush(256);
        this._if(".GTE", ".ARG0", ".ARG1", clampLabel, 1);
        this._setConst("ARG0", 255);
        this.labelDefine(clampLabel);
      } else if (operation === ".SUB") {
        this._stackPush(0);
        this._if(".LTE", ".ARG0", ".ARG1", clampLabel, 1);
        this._setConst("ARG0", 0);
        this.labelDefine(clampLabel);
      }
    }

    this._set(variableAliasA, ".ARG0");
    this._stackPop(1);
  };

  variableValueOperation = (
    setVariable: string,
    operation: ScriptBuilderRPNOperation,
    value: number,
    clamp: boolean
  ) => {
    const variableAliasA = this.getVariableAlias(setVariable);
    const clampLabel = clamp ? this.getNextLabel() : "";

    this._addComment(`Variables ${operation} Value`);
    this._rpn() //
      .ref(variableAliasA)
      .int8(value)
      .operator(operation)
      .stop();

    if (clamp) {
      if (operation === ".ADD") {
        this._stackPush(256);
        this._if(".GTE", ".ARG0", ".ARG1", clampLabel, 1);
        this._setConst("ARG0", 255);
        this.labelDefine(clampLabel);
      } else if (operation === ".SUB") {
        this._stackPush(0);
        this._if(".LTE", ".ARG0", ".ARG1", clampLabel, 1);
        this._setConst("ARG0", 0);
        this.labelDefine(clampLabel);
      }
    }

    this._set(variableAliasA, ".ARG0");
    this._stackPop(1);
  };

  variableRandomOperation = (
    variable: string,
    operation: ScriptBuilderRPNOperation,
    min: number,
    range: number,
    clamp: boolean
  ) => {
    const variableAlias = this.getVariableAlias(variable);
    const clampLabel = clamp ? this.getNextLabel() : "";

    this._addComment(`Variables ${operation} Random`);
    this._stackPush(0);
    this._randomize();
    this._rand(".ARG0", min, range);
    this._rpn() //
      .ref(variableAlias)
      .ref(".ARG1")
      .operator(operation)
      .stop();

    if (clamp) {
      if (operation === ".ADD") {
        this._stackPush(256);
        this._if(".GTE", ".ARG0", ".ARG1", clampLabel, 1);
        this._setConst("ARG0", 255);
        this.labelDefine(clampLabel);
      } else if (operation === ".SUB") {
        this._stackPush(0);
        this._if(".LTE", ".ARG0", ".ARG1", clampLabel, 1);
        this._setConst("ARG0", 0);
        this.labelDefine(clampLabel);
      }
    }

    this._set(variableAlias, ".ARG0");
    this._stackPop(2);
  };

  variablesAdd = (
    setVariable: string,
    otherVariable: string,
    clamp: boolean
  ) => {
    this.variablesOperation(setVariable, ".ADD", otherVariable, clamp);
  };

  variablesSub = (
    setVariable: string,
    otherVariable: string,
    clamp: boolean
  ) => {
    this.variablesOperation(setVariable, ".SUB", otherVariable, clamp);
  };

  variablesMul = (setVariable: string, otherVariable: string) => {
    this.variablesOperation(setVariable, ".MUL", otherVariable, false);
  };

  variablesDiv = (setVariable: string, otherVariable: string) => {
    this.variablesOperation(setVariable, ".DIV", otherVariable, false);
  };

  variablesMod = (setVariable: string, otherVariable: string) => {
    this.variablesOperation(setVariable, ".MOD", otherVariable, false);
  };

  variableAddFlags = (variable: string, flags: number) => {
    const variableAlias = this.getVariableAlias(variable);
    this._addComment(`Variable Add Flags`);
    this._rpn() //
      .ref(variableAlias)
      .int8(flags)
      .operator(".B_OR")
      .stop();
    this._set(variableAlias, ".ARG0");
    this._stackPop(1);
  };

  variableClearFlags = (variable: string, flags: number) => {
    const variableAlias = this.getVariableAlias(variable);
    this._addComment(`Variable Clear Flags`);
    this._rpn() //
      .ref(variableAlias)
      .int8(-1)
      .int8(flags)
      .operator(".B_XOR")
      .operator(".B_AND")
      .stop();
    this._set(variableAlias, ".ARG0");
    this._stackPop(1);
  };

  // --------------------------------------------------------------------------
  // Labels

  getNextLabel = (): string => {
    const label = this.nextLabel++;
    return String(label);
  };

  labelDefine = (name: string) => {
    this._label(name);
  };

  labelGoto = (name: string) => {
    this._jump(name);
  };

  // --------------------------------------------------------------------------
  // Control Flow

  ifVariableTrue = (
    variable: string,
    truePath: ScriptEvent[] | ScriptBuilderPathFunction = [],
    falsePath: ScriptEvent[] | ScriptBuilderPathFunction = []
  ) => {
    const variableAlias = this.getVariableAlias(variable);
    const trueLabel = this.getNextLabel();
    const endLabel = this.getNextLabel();
    this._addComment(`If Variable True`);
    this._ifConst(".EQ", variableAlias, 1, trueLabel, 0);
    this._compilePath(falsePath);
    this._jump(endLabel);
    this._label(trueLabel);
    this._compilePath(truePath);
    this._label(endLabel);
  };

  ifVariableValue = (
    variable: string,
    operator: ScriptBuilderComparisonOperator,
    value: number,
    truePath: ScriptEvent[] | ScriptBuilderPathFunction = [],
    falsePath: ScriptEvent[] | ScriptBuilderPathFunction = []
  ) => {
    const variableAlias = this.getVariableAlias(variable);
    const trueLabel = this.getNextLabel();
    const endLabel = this.getNextLabel();
    this._addComment(`If Variable ${operator} Value`);
    this._ifConst(operator, variableAlias, value, trueLabel, 0);
    this._compilePath(falsePath);
    this._jump(endLabel);
    this._label(trueLabel);
    this._compilePath(truePath);
    this._label(endLabel);
  };

  ifVariableCompare = (
    variableA: string,
    operator: ScriptBuilderComparisonOperator,
    variableB: string,
    truePath: ScriptEvent[] | ScriptBuilderPathFunction = [],
    falsePath: ScriptEvent[] | ScriptBuilderPathFunction = []
  ) => {
    const variableAliasA = this.getVariableAlias(variableA);
    const variableAliasB = this.getVariableAlias(variableB);
    const trueLabel = this.getNextLabel();
    const endLabel = this.getNextLabel();
    this._addComment(`If Variable ${operator} Variable`);
    this._if(operator, variableAliasA, variableAliasB, trueLabel, 0);
    this._compilePath(falsePath);
    this._jump(endLabel);
    this._label(trueLabel);
    this._compilePath(truePath);
    this._label(endLabel);
  };

  ifVariableBitwiseValue = (
    variable: string,
    operator: ScriptBuilderRPNOperation,
    flags: number,
    truePath: ScriptEvent[] | ScriptBuilderPathFunction = [],
    falsePath: ScriptEvent[] | ScriptBuilderPathFunction = []
  ) => {
    const variableAlias = this.getVariableAlias(variable);
    const trueLabel = this.getNextLabel();
    const endLabel = this.getNextLabel();
    this._addComment(`If Variable ${operator} Value`);
    this._rpn() //
      .ref(variableAlias)
      .int8(flags)
      .operator(operator)
      .stop();
    this._ifConst(".NE", ".ARG0", 0, trueLabel, 1);
    this._compilePath(falsePath);
    this._jump(endLabel);
    this._label(trueLabel);
    this._compilePath(truePath);
    this._label(endLabel);
  };

  ifColorSupported = (truePath = [], falsePath = []) => {
    const falseLabel = this.getNextLabel();
    const endLabel = this.getNextLabel();
    this._addComment(`If Color Supported`);
    this._stackPush(0);
    this._getUInt8(".ARG0", "_cpu");
    this._ifConst(".NE", ".ARG0", "0x11", falseLabel, 1);
    this._compilePath(truePath);
    this._jump(endLabel);
    this._label(falseLabel);
    this._compilePath(falsePath);
    this._label(endLabel);
  };

  _compilePath = (path: ScriptEvent[] | ScriptBuilderPathFunction = []) => {
    const { compileEvents } = this.options;
    if (typeof path === "function") {
      path();
    } else if (path) {
      compileEvents(this, path);
    }
  };

  scriptEnd = () => {
    this._stop();
  };

  compileEvents = (path: ScriptEvent[]) => {
    const { compileEvents } = this.options;
    compileEvents(this, path);
  };

  /*

  actorMoveTo = (x = 0, y = 0, useCollisions = false, moveType) => {
    const output = this.output;
    output.push(cmd(ACTOR_MOVE_TO));
    output.push(x);
    output.push(y);
    output.push(useCollisions ? 1 : 0);
    output.push(moveTypeDec(moveType));
  };

  actorMoveRelative = (x = 0, y = 0, useCollisions = false, moveType) => {
    const output = this.output;
    output.push(cmd(ACTOR_MOVE_RELATIVE));
    output.push(Math.abs(x));
    output.push(x < 0 ? 1 : 0);
    output.push(Math.abs(y));
    output.push(y < 0 ? 1 : 0);
    output.push(useCollisions ? 1 : 0);
    output.push(moveTypeDec(moveType));
  };

  actorMoveToVariables = (
    variableX,
    variableY,
    useCollisions = false,
    moveType
  ) => {
    const output = this.output;
    this.vectorsLoad(variableX, variableY);
    output.push(cmd(ACTOR_MOVE_TO_VALUE));
    output.push(useCollisions ? 1 : 0);
    output.push(moveTypeDec(moveType));
  };

  actorSetPosition = (x = 0, y = 0) => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_POSITION));
    output.push(x);
    output.push(y);
  };

  actorSetPositionRelative = (x = 0, y = 0) => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_POSITION_RELATIVE));
    output.push(Math.abs(x));
    output.push(x < 0 ? 1 : 0);
    output.push(Math.abs(y));
    output.push(y < 0 ? 1 : 0);
  };

  actorSetPositionToVariables = (variableX, variableY) => {
    const output = this.output;
    this.vectorsLoad(variableX, variableY);
    output.push(cmd(ACTOR_SET_POSITION_TO_VALUE));
  };

  actorGetPosition = (variableX, variableY) => {
    const output = this.output;
    this.vectorsLoad(variableX, variableY);
    output.push(cmd(ACTOR_GET_POSITION));
  };

  actorSetDirection = (direction = "down") => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_DIRECTION));
    output.push(dirDec(direction));
  };

  actorSetMovementSpeed = (speed = 1) => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_MOVE_SPEED));
    output.push(moveSpeedDec(speed));
  };

  actorSetAnimationSpeed = (speed = 3) => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_ANIM_SPEED));
    output.push(animSpeedDec(speed));
  };

  actorSetFrame = (frame = 0) => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_FRAME));
    output.push(frame || 0);
  };

  actorSetFrameToVariable = (variable) => {
    const output = this.output;
    const { variables } = this.options;
    const variableIndex = this.getVariableIndex(variable, variables);
    output.push(cmd(ACTOR_SET_FRAME_TO_VALUE));
    output.push(hi(variableIndex));
    output.push(lo(variableIndex));
  };

  actorSetFlip = (flip) => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_FLIP));
    output.push(flip ? 1 : 0);
  };

  actorPush = (continueUntilCollision = false) => {
    const output = this.output;
    output.push(cmd(ACTOR_PUSH));
    output.push(continueUntilCollision ? 1 : 0);
  };

  actorEmote = (emoteId = 0) => {
    const output = this.output;
    output.push(cmd(ACTOR_EMOTE));
    output.push(emoteId);
  };

  actorInvoke = () => {
    const output = this.output;
    output.push(cmd(ACTOR_INVOKE));
  };

  actorShow = () => {
    const output = this.output;
    output.push(cmd(ACTOR_SHOW));
  };

  actorHide = () => {
    const output = this.output;
    output.push(cmd(ACTOR_HIDE));
  };

  actorStopUpdate = () => {
    const output = this.output;
    output.push(cmd(ACTOR_STOP_UPDATE));
  };

  actorSetCollisions = (enabled) => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_COLLISIONS));
    output.push(enabled ? 1 : 0);
  };

  actorSetAnimate = (enabled) => {
    const output = this.output;
    output.push(cmd(ACTOR_SET_ANIMATE));
    output.push(enabled ? 1 : 0);
  };

  actorSetSprite = (spriteSheetId) => {
    const output = this.output;
    const { sprites, scene } = this.options;
    const spriteOffset = getSpriteOffset(spriteSheetId, sprites, scene);
    const sprite = getSprite(spriteSheetId, sprites);
    output.push(cmd(ACTOR_SET_SPRITE));
    output.push(spriteOffset);
    output.push(sprite.frames);
  };

  // Player

  playerSetSprite = (spriteSheetId, persist) => {
    const output = this.output;
    const { sprites } = this.options;
    const spriteIndex = getSpriteIndex(spriteSheetId, sprites);
    output.push(cmd(PLAYER_SET_SPRITE));
    output.push(hi(spriteIndex));
    output.push(lo(spriteIndex));
    output.push(persist ? 1 : 0);
  };

  playerBounce = (height) => {
    const output = this.output;
    output.push(cmd(PLAYER_BOUNCE));
    output.push(heightDec(height));
  };

  // Sprites

  spritesShow = () => {
    const output = this.output;
    output.push(cmd(SHOW_SPRITES));
  };

  spritesHide = () => {
    const output = this.output;
    output.push(cmd(HIDE_SPRITES));
  };

  // Weapons

  weaponAttack = (
    spriteSheetId,
    offset = 10,
    collisionGroup,
    collisionMask
  ) => {
    const output = this.output;
    const { sprites, scene } = this.options;
    const spriteSceneIndex = getSpriteSceneIndex(spriteSheetId, sprites, scene);

    output.push(cmd(WEAPON_ATTACK));
    output.push(spriteSceneIndex);
    output.push(offset);
    output.push(
      (collisionMaskDec(collisionMask) << 4) + collisionGroupDec(collisionGroup)
    );
  };

  launchProjectile = (
    spriteSheetId,
    x,
    y,
    dirVariable,
    speed,
    collisionGroup,
    collisionMask
  ) => {
    const output = this.output;
    const { sprites, variables, scene } = this.options;
    const spriteSceneIndex = getSpriteSceneIndex(spriteSheetId, sprites, scene);
    const dirVariableIndex = this.getVariableIndex(dirVariable, variables);

    output.push(cmd(LAUNCH_PROJECTILE));
    output.push(spriteSceneIndex);
    output.push(hi(dirVariableIndex));
    output.push(lo(dirVariableIndex));
    output.push(moveSpeedDec(speed));
    output.push(
      (collisionMaskDec(collisionMask) << 4) + collisionGroupDec(collisionGroup)
    );
  };

  // Palette

  paletteSetBackground = (eventId, mask) => {
    const output = this.output;
    const { eventPaletteIndexes } = this.options;
    const paletteIndex = eventPaletteIndexes[eventId] || 0;
    output.push(cmd(PALETTE_SET_BACKGROUND));
    output.push(paletteMaskDec(mask));
    output.push(hi(paletteIndex));
    output.push(lo(paletteIndex));
  };

  paletteSetActor = (eventId) => {
    const output = this.output;
    const { eventPaletteIndexes } = this.options;
    const paletteIndex = eventPaletteIndexes[eventId] || 0;
    output.push(cmd(PALETTE_SET_ACTOR));
    output.push(hi(paletteIndex));
    output.push(lo(paletteIndex));
  };

  paletteSetUI = (eventId) => {
    const output = this.output;
    const { eventPaletteIndexes } = this.options;
    const paletteIndex = eventPaletteIndexes[eventId] || 0;
    output.push(cmd(PALETTE_SET_UI));
    output.push(hi(paletteIndex));
    output.push(lo(paletteIndex));
  };

  // Variables

  */

  //   variableSetToProperty = (variable, property) => {
  //     const output = this.output;
  //     const { variables, scene, entity } = this.options;
  //     const variableIndex = this.getVariableIndex(variable, variables);
  //     const actorValue = property && property.replace(/:.*/, "");
  //     const propertyValue = property && property.replace(/.*:/, "");
  //     const actorIndex =
  //       actorValue === "$self$"
  //         ? getActorIndex(entity.id, scene)
  //         : getActorIndex(actorValue, scene);
  //     const properties = [
  //       "xpos",
  //       "ypos",
  //       "direction",
  //       "moveSpeed",
  //       "animSpeed",
  //       "frame",
  //     ];
  //     const propertyIndex = properties.indexOf(propertyValue);
  //     output.push(cmd(SET_PROPERTY));
  //     output.push(hi(variableIndex));
  //     output.push(lo(variableIndex));
  //     output.push(Math.max(0, propertyIndex));
  //     output.push(actorIndex);
  //   };

  /*

  variablesReset = () => {
    const output = this.output;
    output.push(cmd(RESET_VARIABLES));
  };



  temporaryEntityVariable = (index) => {
    const { entity } = this.options;
    return `${entity.id}__${index}`;
  };

  variableFromUnion = (unionValue, defaultVariable) => {
    if (unionValue.type === "variable") {
      return unionValue.value;
    }
    this.variableSetToUnionValue(defaultVariable, unionValue);
    return defaultVariable;
  };

  variableSetToUnionValue = (variable, unionValue) => {
    if (unionValue.type === "number") {
      this.variableSetToValue(variable, unionValue.value);
      return variable;
    }
    if (unionValue.type === "direction") {
      this.variableSetToValue(variable, dirDec(unionValue.value));
      return variable;
    }
    if (unionValue.type === "property") {
      this.variableSetToProperty(variable, unionValue.value);
      return variable;
    }
    if (unionValue.type === "variable") {
      this.variableCopy(variable, unionValue.value);
      return variable;
    }
    throw new Error(`Union type "${unionValue.type}" unknown.`);
  };

  // Engine Fields

  engineFieldSetToValue = (key, value) => {
    const output = this.output;
    const { engineFields } = this.options;
    const engineField = engineFields[key];
    if (engineField !== undefined) {
      const cType = engineField.field.cType;
      let newValue = value;
      if (newValue === "" || newValue === undefined) {
        newValue = engineField.field.defaultValue || 0;
      }
      if (newValue === true) {
        newValue = 1;
      }
      if (newValue === false) {
        newValue = 0;
      }
      if (is16BitCType(cType)) {
        if (newValue < 0) {
          // Convert negative to two's complement
          newValue = 0xffff & ~(-newValue - 1);
        }
        output.push(cmd(ENGINE_FIELD_UPDATE_WORD));
        output.push(hi(engineField.offset));
        output.push(lo(engineField.offset));
        output.push(hi(newValue));
        output.push(lo(newValue));
      } else {
        if (newValue < 0) {
          // Convert negative to two's complement
          newValue = 0xff & ~(-newValue - 1);
        }
        output.push(cmd(ENGINE_FIELD_UPDATE));
        output.push(hi(engineField.offset));
        output.push(lo(engineField.offset));
        output.push(newValue);
      }
    }
  };

  engineFieldSetToVariable = (key, variable) => {
    const output = this.output;
    const { engineFields, variables } = this.options;
    const engineField = engineFields[key];
    if (engineField !== undefined) {
      const cType = engineField.field.cType;
      if (is16BitCType(cType)) {
        const loVariable = nextVariable(variable);
        const hiIndex = this.getVariableIndex(variable, variables);
        const loIndex = this.getVariableIndex(loVariable, variables);
        output.push(cmd(ENGINE_FIELD_UPDATE_VAR_WORD));
        output.push(hi(engineField.offset));
        output.push(lo(engineField.offset));
        output.push(hi(hiIndex));
        output.push(lo(hiIndex));
        output.push(hi(loIndex));
        output.push(lo(loIndex));
      } else {
        const variableIndex = this.getVariableIndex(variable, variables);
        output.push(cmd(ENGINE_FIELD_UPDATE_VAR));
        output.push(hi(engineField.offset));
        output.push(lo(engineField.offset));
        output.push(hi(variableIndex));
        output.push(lo(variableIndex));
      }
    }
  };

  engineFieldStoreInVariable = (key, variable) => {
    const output = this.output;
    const { engineFields, variables } = this.options;
    const engineField = engineFields[key];
    if (engineField !== undefined) {
      const cType = engineField.field.cType;
      if (is16BitCType(cType)) {
        const loVariable = nextVariable(variable);
        const hiIndex = this.getVariableIndex(variable, variables);
        const loIndex = this.getVariableIndex(loVariable, variables);
        output.push(cmd(ENGINE_FIELD_STORE_WORD));
        output.push(hi(engineField.offset));
        output.push(lo(engineField.offset));
        output.push(hi(loIndex));
        output.push(lo(loIndex));
        output.push(hi(hiIndex));
        output.push(lo(hiIndex));
      } else {
        const variableIndex = this.getVariableIndex(variable, variables);
        output.push(cmd(ENGINE_FIELD_STORE));
        output.push(hi(engineField.offset));
        output.push(lo(engineField.offset));
        output.push(hi(variableIndex));
        output.push(lo(variableIndex));
      }
    }
  };

  // Scenes

  sceneSwitch = (sceneId, x = 0, y = 0, direction = "down", fadeSpeed = 2) => {
    const output = this.output;
    const { scenes } = this.options;
    const sceneIndex = scenes.findIndex((s) => s.id === sceneId);
    if (sceneIndex > -1) {
      output.push(cmd(SWITCH_SCENE));
      output.push(hi(sceneIndex));
      output.push(lo(sceneIndex));
      output.push(x);
      output.push(y);
      output.push(dirDec(direction));
      output.push(fadeSpeed);
      this.scriptEnd();
    }
  };

  scenePushState = () => {
    const output = this.output;
    output.push(cmd(SCENE_PUSH_STATE));
  };

  scenePopState = (fadeSpeed = 2) => {
    const output = this.output;
    output.push(cmd(SCENE_POP_STATE));
    output.push(fadeSpeed);
  };

  scenePopAllState = (fadeSpeed = 2) => {
    const output = this.output;
    output.push(cmd(SCENE_POP_ALL_STATE));
    output.push(fadeSpeed);
  };

  sceneResetState = () => {
    const output = this.output;
    output.push(cmd(SCENE_STATE_RESET));
  };

  // Overlays

  overlayShow = (color = "white", x = 0, y = 0) => {
    const output = this.output;
    output.push(cmd(OVERLAY_SHOW));
    output.push(color === "white" ? 1 : 0);
    output.push(x);
    output.push(y);
  };

  overlayHide = () => {
    const output = this.output;
    output.push(cmd(OVERLAY_HIDE));
  };

  overlayMoveTo = (x = 0, y = 18, speed = 0) => {
    const output = this.output;
    output.push(cmd(OVERLAY_MOVE_TO));
    output.push(x);
    output.push(y);
    output.push(speed);
  };

  // Control Flow



  caseVariableValue = (variable, cases = {}, falsePath = []) => {
    const output = this.output;
    const { variables, compileEvents } = this.options;
    const variableIndex = this.getVariableIndex(variable, variables);
    const caseKeys = Object.keys(cases);
    const numCases = caseKeys.length;
    const caseStartPtrs = [];
    const caseBreakPtrs = [];

    if (numCases === 0) {
      // If no cases defined run default path
      if (typeof falsePath === "function") {
        falsePath();
      } else if (falsePath) {
        compileEvents(falsePath);
      }
    } else {
      // Loop through cases and build IF_VALUE commands
      for (let i = 0; i < numCases; i++) {
        output.push(cmd(IF_VALUE));
        output.push(hi(variableIndex));
        output.push(lo(variableIndex));
        output.push(operatorDec("=="));
        output.push(caseKeys[i] || 0);
        caseStartPtrs[i] = output.length;
        output.push("PTR_PLACEHOLDER1");
        output.push("PTR_PLACEHOLDER2");
      }

      // Default path
      if (typeof falsePath === "function") {
        falsePath();
      } else if (falsePath) {
        compileEvents(falsePath);
      }

      // Set placeholder for jump to end of case statement
      output.push(cmd(JUMP));
      const endPtrIndex = output.length;
      output.push("PTR_PLACEHOLDER1");
      output.push("PTR_PLACEHOLDER2");

      // Loop through cases to build branches
      for (let i = 0; i < numCases; i++) {
        const truePointer = output.length;
        const truePtrIndex = caseStartPtrs[i];
        output[truePtrIndex] = truePointer >> 8;
        output[truePtrIndex + 1] = truePointer & 0xff;

        const truePath = cases[caseKeys[i]] || [];
        if (typeof truePath === "function") {
          truePath();
        } else if (truePath) {
          compileEvents(truePath);
        }

        // Store placeholders for breaks to end of case statement
        output.push(cmd(JUMP));
        caseBreakPtrs[i] = output.length;
        output.push("PTR_PLACEHOLDER1");
        output.push("PTR_PLACEHOLDER2");
      }

      // Fill default path break placeholder
      const endIfPointer = output.length;
      output[endPtrIndex] = endIfPointer >> 8;
      output[endPtrIndex + 1] = endIfPointer & 0xff;

      // Fill case paths break placeholders
      for (let i = 0; i < numCases; i++) {
        const breakPtrIndex = caseBreakPtrs[i];
        output[breakPtrIndex] = endIfPointer >> 8;
        output[breakPtrIndex + 1] = endIfPointer & 0xff;
      }
    }
  };



  ifInput = (input, truePath = [], falsePath = []) => {
    const output = this.output;
    output.push(cmd(IF_INPUT));
    output.push(inputDec(input));
    compileConditional(truePath, falsePath, {
      ...this.options,
      output,
    });
  };

  ifActorAtPosition = (x, y, truePath = [], falsePath = []) => {
    const output = this.output;
    output.push(cmd(IF_ACTOR_AT_POSITION));
    output.push(x || 0);
    output.push(y || 0);
    compileConditional(truePath, falsePath, {
      ...this.options,
      output,
    });
  };

  ifActorDirection = (direction, truePath = [], falsePath = []) => {
    const output = this.output;
    output.push(cmd(IF_ACTOR_DIRECTION));
    output.push(dirDec(direction));
    compileConditional(truePath, falsePath, {
      ...this.options,
      output,
    });
  };

  ifActorRelativeToActor = (
    operation,
    otherId,
    truePath = [],
    falsePath = []
  ) => {
    const output = this.output;
    const { scene, entity } = this.options;
    const otherIndex =
      otherId === "$self$"
        ? getActorIndex(entity.id, scene)
        : getActorIndex(otherId, scene);
    output.push(cmd(IF_ACTOR_RELATIVE_TO_ACTOR));
    output.push(actorRelativeDec(operation));
    output.push(otherIndex);
    compileConditional(truePath, falsePath, {
      ...this.options,
      output,
    });
  };

  ifDataSaved = (truePath = [], falsePath = []) => {
    const output = this.output;
    output.push(cmd(IF_SAVED_DATA));
    compileConditional(truePath, falsePath, {
      ...this.options,
      output,
    });
  };



  // Input

  inputAwait = (input) => {
    const output = this.output;
    output.push(cmd(AWAIT_INPUT));
    output.push(inputDec(input));
  };

  inputScriptSet = (input, persist, script) => {
    const output = this.output;
    const { compileEvents, banked } = this.options;

    const subScript = [];
    if (typeof script === "function") {
      this.output = subScript;
      script();
      this.output = output;
    } else {
      compileEvents(script, subScript, false);
    }
    const bankPtr = banked.push(subScript);

    output.push(cmd(SET_INPUT_SCRIPT));
    output.push(inputDec(input));
    output.push(persist ? 1 : 0);
    output.push(bankPtr.bank);
    output.push(hi(bankPtr.offset));
    output.push(lo(bankPtr.offset));
  };

  inputScriptRemove = (input) => {
    const output = this.output;
    output.push(cmd(REMOVE_INPUT_SCRIPT));
    output.push(inputDec(input));
  };

  // Camera

  cameraMoveTo = (x = 0, y = 0, speed = 0) => {
    const output = this.output;
    const { scene } = this.options;
    output.push(cmd(CAMERA_MOVE_TO));
    // Limit camera move to be within scene bounds
    const camX = Math.min(x, scene.width - 20);
    const camY = Math.min(y, scene.height - 18);
    output.push(camX);
    output.push(camY);
    // Direct speed in binary, first bits 0000 to 1111 are "&" compared with binary time
    // Speed 0 = 0 instant, Speed 1 = 32 0x20 move every frame, Speed 2 = 33 0x21
    const speedFlag = speed > 0 ? 32 + (1 << (speed - 1)) - 1 : 0;
    output.push(speedFlag);
  };

  cameraLock = (speed = 0) => {
    const output = this.output;
    const speedFlag = speed > 0 ? 32 + (1 << (speed - 1)) - 1 : 0;
    output.push(cmd(CAMERA_LOCK));
    output.push(speedFlag);
  };

  cameraShake = (shouldShakeX, shouldShakeY, frames) => {
    const output = this.output;
    output.push(cmd(CAMERA_SHAKE));
    output.push(shouldShakeX ? 1 : 0);
    output.push(shouldShakeY ? 1 : 0);
    output.push(frames);
  };

  // Screen

  fadeIn = (speed = 1) => {
    const output = this.output;
    output.push(cmd(FADE_IN));
    output.push(speed);
  };

  fadeOut = (speed = 1) => {
    const output = this.output;
    output.push(cmd(FADE_OUT));
    output.push(speed);
  };

  // Music

  musicPlay = (musicId, loop = false) => {
    const output = this.output;
    const { music } = this.options;
    const musicIndex = getMusicIndex(musicId, music);
    if (musicIndex >= 0) {
      output.push(cmd(MUSIC_PLAY));
      output.push(musicIndex);
      output.push(loop ? 1 : 0); // Loop track
    }
  };

  musicStop = () => {
    const output = this.output;
    output.push(cmd(MUSIC_STOP));
  };

  // Sound

  soundStartTone = (period = 1600, toneFrames = 30) => {
    const output = this.output;

    // start playing tone
    output.push(cmd(SOUND_START_TONE));
    output.push(hi(period));
    output.push(lo(period));
    output.push(lo(toneFrames));
  };

  soundStopTone = () => {
    const output = this.output;
    output.push(cmd(SOUND_STOP_TONE));
  };

  soundPlayBeep = (pitch = 4) => {
    const output = this.output;

    pitch = pitch - 1;
    if (pitch < 0) {
      pitch = 0;
    }
    if (pitch >= 8) {
      pitch = 7;
    }

    output.push(cmd(SOUND_PLAY_BEEP));
    output.push(pitch & 0x07);
  };

  soundPlayCrash = () => {
    const output = this.output;
    output.push(cmd(SOUND_PLAY_CRASH));
  };

  // Data

  dataLoad = () => {
    const output = this.output;
    output.push(cmd(LOAD_DATA));
  };

  dataSave = () => {
    const output = this.output;
    output.push(cmd(SAVE_DATA));
  };

  dataClear = () => {
    const output = this.output;
    output.push(cmd(CLEAR_DATA));
  };

  // Timer Script

  timerScriptSet = (duration = 10.0, script) => {
    const output = this.output;
    const { compileEvents, banked } = this.options;

    // convert the duration from seconds to timer ticks
    const TIMER_CYCLES = 16;
    let durationTicks = ((60 * duration) / TIMER_CYCLES + 0.5) | 0;
    if (durationTicks <= 0) {
      durationTicks = 1;
    }
    if (durationTicks >= 256) {
      durationTicks = 255;
    }

    // compile event script
    const subScript = [];
    if (typeof script === "function") {
      this.output = subScript;
      script();
      this.output = output;
    } else {
      compileEvents(script, subScript, false);
    }
    const bankPtr = banked.push(subScript);

    output.push(cmd(SET_TIMER_SCRIPT));
    output.push(durationTicks);
    output.push(bankPtr.bank);
    output.push(hi(bankPtr.offset));
    output.push(lo(bankPtr.offset));
  };

  timerRestart = () => {
    const output = this.output;
    output.push(cmd(TIMER_RESTART));
  };

  timerDisable = () => {
    const output = this.output;
    output.push(cmd(TIMER_DISABLE));
  };

  // Device



  // Helpers

  getSprite = (name, plugin = "") => {
    const { sprites } = this.options;
    const searchName = name.toUpperCase();
    const searchPlugin = plugin.toUpperCase();
    const sprite = sprites.find((s) => {
      return (
        (searchName === s.name.toUpperCase() ||
          searchName === s.filename.toUpperCase()) &&
        (!plugin || searchPlugin === s.plugin.toUpperCase())
      );
    });
    if (sprite) {
      return sprite.id;
    }
    throw new Error(`Sprite ${name} not found`);
  };

  getActor = (name) => {
    if (name === "player") {
      return name;
    }
    const { scene } = this.options;
    const searchName = name.toUpperCase();
    const actor = scene.actors.find(
      (a, i) =>
        (a.name && searchName === a.name.toUpperCase()) ||
        searchName === `ACTOR ${i + 1}`
    );
    if (actor) {
      return actor.id;
    }
    throw new Error(`Actor ${name} not found`);
  };

  getActorById = (id) => {
    const output = this.output;
    const { scene, entity } = this.options;
    return id === "$self$" ? getActor(entity.id, scene) : getActor(id, scene);
  };

  replaceVariables = (string, variables, event) => {
    const getVariableSymbol = (index) => `$${String(index).padStart(2, "0")}$`;
    const getVariableCharSymbol = (index) =>
      `#${String(index).padStart(2, "0")}#`;

    return (
      string
        // Replace Global variables
        .replace(/\$([0-9]+)\$/g, (match, globalVariable) => {
          const index = this.getVariableIndex(globalVariable, variables);
          return getVariableSymbol(index);
        })
        // Replace Local variables
        .replace(/\$(L[0-9])\$/g, (match, localVariable) => {
          const index = this.getVariableIndex(localVariable, variables);
          return getVariableSymbol(index);
        })
        // Replace Temp variables
        .replace(/\$(T[0-9])\$/g, (match, tempVariable) => {
          const index = this.getVariableIndex(tempVariable, variables);
          return getVariableSymbol(index);
        })
        // Replace Custom Event variables
        .replace(/\$V([0-9])\$/g, (match, customVariable) => {
          const mappedVariable = event.args[`$variable[${customVariable}]$`];
          const index = this.getVariableIndex(mappedVariable, variables);
          return getVariableSymbol(index);
        })
        // Replace Global variable characters
        .replace(/#([0-9]+)#/g, (match, globalVariable) => {
          const index = this.getVariableIndex(globalVariable, variables);
          return getVariableCharSymbol(index);
        })
        // Replace Local variable characters
        .replace(/#(L[0-9])#/g, (match, localVariable) => {
          const index = this.getVariableIndex(localVariable, variables);
          return getVariableCharSymbol(index);
        })
        // Replace Temp variable characters
        .replace(/#(T[0-9])#/g, (match, tempVariable) => {
          const index = this.getVariableIndex(tempVariable, variables);
          return getVariableCharSymbol(index);
        })
        // Replace Custom Event variable characters
        .replace(/#V([0-9])#/g, (match, customVariable) => {
          const mappedVariable = event.args[`$variable[${customVariable}]$`];
          const index = this.getVariableIndex(mappedVariable, variables);
          return getVariableCharSymbol(index);
        })
    );

  };
*/

  // --------------------------------------------------------------------------
  // Export

  toScriptString = (name: string) => {
    this._assertStackNeutral();
    return `.include "vm.i"
.include "game_globals.i"
${
  this.dependencies.length > 0
    ? `\n.globl ${this.dependencies.join(", ")}\n`
    : ""
}
.area _CODE_255

___bank_${name} = 255
.globl ___bank_${name}

_${name}::
${this.output.join("\n")}
`;
  };
}

export default ScriptBuilder;
