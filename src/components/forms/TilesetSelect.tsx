import React, { FC, useEffect, useState } from "react";
import { useAppSelector } from "store/hooks";
import { tilesetSelectors } from "store/features/entities/entitiesState";
import {
  UnitType,
  Tileset,
  GridUnitType,
} from "shared/lib/entities/entitiesTypes";
import {
  Option,
  OptGroup,
  Select,
  OptionLabelWithPreview,
  SingleValueWithPreview,
  SelectCommonProps,
} from "ui/form/Select";
import { TileCanvas } from "components/world/TileCanvas";
import uniq from "lodash/uniq";
import styled from "styled-components";

interface TilesetSelectProps extends SelectCommonProps {
  name: string;
  value?: string;
  tileIndex?: number;
  onChange?: (newId: string) => void;
  units?: UnitType;
  optional?: boolean;
  optionalLabel?: string;
}

interface TilesetOption extends Option {
  tileset: Tileset;
}

const Wrapper = styled.div`
  position: relative;
`;

const buildOptions = (
  memo: OptGroup[],
  plugin: string | undefined,
  tilesets: Tileset[]
) => {
  memo.push({
    label: plugin ? plugin : "",
    options: tilesets.map((tileset) => {
      return {
        value: tileset.id,
        label: tileset.name,
      };
    }),
  });
};

export const TilesetSelect: FC<TilesetSelectProps> = ({
  value,
  tileIndex,
  onChange,
  units,
  optional,
  optionalLabel,
  ...selectProps
}) => {
  const tilesets = useAppSelector((state) => tilesetSelectors.selectAll(state));
  const [options, setOptions] = useState<OptGroup[]>([]);
  const [currentTileset, setCurrentTileset] = useState<Tileset>();
  const [currentValue, setCurrentValue] = useState<Option>();

  useEffect(() => {
    const plugins = uniq(tilesets.map((s) => s.plugin || "")).sort();
    const options = plugins.reduce(
      (memo, plugin) => {
        buildOptions(
          memo,
          plugin,
          tilesets.filter((s) => (plugin ? s.plugin === plugin : !s.plugin))
        );
        return memo;
      },
      optional
        ? ([
            {
              label: "",
              options: [{ value: "", label: optionalLabel || "None" }],
            },
          ] as OptGroup[])
        : ([] as OptGroup[])
    );

    setOptions(options);
  }, [tilesets, optional, optionalLabel]);

  useEffect(() => {
    setCurrentTileset(tilesets.find((v) => v.id === value));
  }, [tilesets, value]);

  useEffect(() => {
    if (currentTileset) {
      setCurrentValue({
        value: currentTileset.id,
        label: `${currentTileset.name}`,
      });
    } else if (optional) {
      setCurrentValue({
        value: "",
        label: optionalLabel || "None",
      });
    }
  }, [currentTileset, optional, optionalLabel]);

  const onSelectChange = (newValue: Option) => {
    onChange?.(newValue.value);
  };

  return (
    <Wrapper>
      <Select
        value={currentValue}
        options={options}
        onChange={onSelectChange}
        formatOptionLabel={(option: TilesetOption) => {
          return (
            <OptionLabelWithPreview
              preview={
                <TileCanvas
                  tilesetId={option.value}
                  tileIndex={tileIndex}
                  tileSize={units as GridUnitType}
                />
              }
            >
              {option.label}
            </OptionLabelWithPreview>
          );
        }}
        components={{
          SingleValue: () => (
            <SingleValueWithPreview
              preview={
                <TileCanvas
                  tilesetId={value || ""}
                  tileIndex={tileIndex}
                  tileSize={units as GridUnitType}
                />
              }
            >
              {currentValue?.label}
            </SingleValueWithPreview>
          ),
        }}
        {...selectProps}
      />
    </Wrapper>
  );
};
