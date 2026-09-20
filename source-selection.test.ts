import { deepEqual } from "node:assert/strict";
import { selectCarryOverSources } from "./source-selection";

interface Candidate {
  name: string;
  day: number;
}

const friday: Candidate = { name: "Friday", day: 5 };
const saturday: Candidate = { name: "Saturday", day: 6 };
const sunday: Candidate = { name: "Sunday", day: 0 };

deepEqual(
  selectCarryOverSources(1, [sunday, saturday, friday]).map(({ name }) => name),
  ["Sunday", "Friday"],
  "Monday includes both the newest weekend note and the last weekday note",
);

deepEqual(
  selectCarryOverSources(0, [saturday, friday]).map(({ name }) => name),
  ["Saturday"],
  "weekend runs do not pull in weekday todos",
);

deepEqual(
  selectCarryOverSources(2, [friday]).map(({ name }) => name),
  ["Friday"],
  "a weekday note is not selected twice",
);

deepEqual(selectCarryOverSources(1, []), [], "no notes produces no sources");

console.log("Source-selection tests passed.");
