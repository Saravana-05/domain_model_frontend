import type { ComponentType } from "react";
import { TextField } from "../components/fields/TextField";
import { SelectField } from "../components/fields/SelectField";
import { NumberField } from "../components/fields/NumberField";
import { CheckboxField } from "../components/fields/CheckboxField";
import { Section } from "../components/layout/Section";
import { Row } from "../components/layout/Row";
import { Tabs } from "../components/layout/Tabs";

export const componentRegistry: Record<string, ComponentType<any>> = {
  // Field types
  text: TextField,
  textarea: TextField, // reuses TextField with multiline prop
  number: NumberField,
  select: SelectField,
  checkbox: CheckboxField,

  // Layout types
  section: Section,
  row: Row,
  tabs: Tabs,
};
