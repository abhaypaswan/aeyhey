"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// The form controls Aeyhey uses more than once, on UI SDK.
//
// A native <select> cannot be styled to match the rest of the app, and a native
// checkbox standing in for a setting that takes effect immediately is the wrong
// control. Both go through UI SDK here, which also gets the keyboard and ARIA right.

import type { ReactNode } from "react";
import { Check, ChevronDown, Eye, EyeOff, Minus, Plus } from "lucide-react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxList,
  ComboboxTrigger,
} from "@ui-sdk/react/combobox";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input";
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@ui-sdk/react/password-input";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from "@ui-sdk/react/slider";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { TimeInput } from "@ui-sdk/react/time-input";
import type { ComponentProps } from "react";

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function SelectField<T extends string>({
  label,
  description,
  value,
  onValueChange,
  options,
  disabled,
  name,
}: {
  label: string;
  description?: ReactNode;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly Option<T>[];
  disabled?: boolean;
  name?: string;
}) {
  return (
    <Field disabled={disabled}>
      <FieldLabel>{label}</FieldLabel>
      <Select
        name={name}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue />
          <ChevronDown size={16} aria-hidden="true" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <SelectItemText>{option.label}</SelectItemText>
              <SelectItemIndicator>
                <Check size={15} aria-hidden="true" />
              </SelectItemIndicator>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

export function SwitchField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  name,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <Field disabled={disabled} className="aeyhey-switch-field">
      <div data-slot="stack">
        <FieldLabel>{label}</FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </div>
      <Switch name={name} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}>
        <SwitchThumb />
      </Switch>
    </Field>
  );
}

/**
 * A whole number with step buttons. Typing, the arrow keys and the buttons all go
 * through UI SDK's NumberInput, which clamps to the range when the field is left. An
 * emptied field reports nothing, so the setting keeps its last real value meanwhile.
 * Goes inside a Field from ui.tsx, which gives it its label.
 */
export function NumberBox({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  disabled,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  const stepButton =
    "text-muted-foreground hover:bg-sunken hover:text-foreground grid h-full w-11 shrink-0 cursor-pointer place-items-center transition-colors data-disabled:cursor-not-allowed data-disabled:opacity-40";

  return (
    <NumberInput
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <NumberInputGroup className="aeyhey-control flex h-11 w-full max-w-48 items-stretch overflow-hidden">
        <NumberInputDecrement aria-label="Decrease" className={stepButton}>
          <Minus size={15} aria-hidden="true" />
        </NumberInputDecrement>
        <NumberInputControl className="border-border h-full w-full min-w-0 flex-1 border-x bg-transparent text-center text-sm tabular-nums outline-none" />
        <NumberInputIncrement aria-label="Increase" className={stepButton}>
          <Plus size={15} aria-hidden="true" />
        </NumberInputIncrement>
      </NumberInputGroup>
    </NumberInput>
  );
}

/** A password or secret key, with a button to show what was typed. Goes inside a Field. */
export function PasswordBox({
  value,
  onValueChange,
  autoComplete,
  ...control
}: {
  value: string;
  onValueChange: (value: string) => void;
  autoComplete: "current-password" | "new-password" | "off";
} & Pick<ComponentProps<"input">, "autoFocus" | "onKeyDown" | "placeholder">) {
  return (
    <PasswordInput
      value={value}
      onValueChange={onValueChange}
      autoComplete={autoComplete}
      className="aeyhey-control flex h-11 w-full items-center pr-1"
    >
      <PasswordInputControl
        {...control}
        className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-sm outline-none"
      />
      <PasswordInputToggle
        aria-label="Show what you typed"
        className="text-subtle-foreground hover:bg-sunken hover:text-foreground grid size-9 shrink-0 cursor-pointer place-items-center rounded-md"
      >
        {(state) =>
          state.visible ? (
            <EyeOff size={16} aria-hidden="true" />
          ) : (
            <Eye size={16} aria-hidden="true" />
          )
        }
      </PasswordInputToggle>
    </PasswordInput>
  );
}

/** One value on a scale. Goes inside a Field, whose label names the thumb. */
export function SliderBox({
  value,
  onValueChange,
  min,
  max,
  step,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <Slider
      value={value}
      onValueChange={(next) => onValueChange(Array.isArray(next) ? (next[0] ?? value) : next)}
      min={min}
      max={max}
      step={step}
    >
      <SliderControl>
        <SliderTrack>
          <SliderIndicator />
          <SliderThumb />
        </SliderTrack>
      </SliderControl>
    </Slider>
  );
}

/**
 * A time of day, typed one part at a time on whichever clock the reader's language uses.
 * The value in and out is always 24-hour "HH:MM", which is what the settings store.
 * Goes inside a Field.
 */
export function TimeBox({
  value,
  onValueChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <TimeInput
      value={value}
      onValueChange={(next) => {
        // Null means a part was emptied mid-edit; the setting keeps its last full time.
        if (next !== null) onValueChange(next.slice(0, 5));
      }}
      className="aeyhey-control inline-flex h-11 w-full items-center px-3 text-sm tabular-nums"
    />
  );
}

/**
 * Pick one from a long list by typing. Unlike a free text field, the value can only be
 * something on the list, which is the point: a timezone with a typo in it is not a
 * timezone. The list filters as you type, and closing without choosing puts the saved
 * choice back.
 */
export function SearchSelectField({
  label,
  description,
  value,
  onValueChange,
  options,
  placeholder,
  emptyText,
  showAllLabel,
}: {
  label: string;
  description?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly Option<string>[];
  placeholder: string;
  emptyText: string;
  /** Names the button that opens the whole list, for a screen reader. */
  showAllLabel: string;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Combobox
        items={options as Option<string>[]}
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string") onValueChange(next);
        }}
        autoHighlight
      >
        <div className="aeyhey-control flex h-11 w-full items-center pr-1">
          <ComboboxInput
            placeholder={placeholder}
            className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-sm outline-none"
          />
          <ComboboxTrigger
            aria-label={showAllLabel}
            className="text-subtle-foreground hover:bg-sunken hover:text-foreground grid size-9 shrink-0 cursor-pointer place-items-center rounded-md"
          >
            <ChevronDown size={16} aria-hidden="true" />
          </ComboboxTrigger>
        </div>
        <ComboboxContent>
          <ComboboxEmpty>{emptyText}</ComboboxEmpty>
          <ComboboxList>
            {(state) =>
              (state.items as Option<string>[]).map((option) => (
                <ComboboxItem key={option.value} value={option.value} label={option.label}>
                  <ComboboxItemText />
                  <ComboboxItemIndicator>
                    <Check size={15} aria-hidden="true" />
                  </ComboboxItemIndicator>
                </ComboboxItem>
              ))
            }
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}
