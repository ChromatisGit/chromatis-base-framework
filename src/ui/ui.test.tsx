import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { Button } from "./primitives/Button";
import { ActionCard, CardBody } from "./primitives/Card";
import { Input } from "./primitives/Input";
import { Tabs } from "./primitives/Tabs";
import { Accordion } from "./primitives/Accordion";
import { DataTable } from "./primitives/DataView";
import { Pagination, paginationModel } from "./primitives/Pagination";
import { Progress } from "./primitives/Loading";
import { Choice, ChoiceGroup } from "./primitives/Choice";
import { Switch } from "./primitives/Switch";

describe("first UI slice", () => {
  test("a busy action remains a native disabled button", () => {
    const html = renderToStaticMarkup(<Button busy>Save</Button>);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
    expect(html).toContain('class="spinner"');
  });

  test("field errors are associated with the input and keep help text", () => {
    const html = renderToStaticMarkup(
      <Input
        id="email"
        label="Email"
        hint="Use your work address"
        error="Required"
      />,
    );
    expect(html).toContain('for="email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-hint email-error"');
    expect(html).toContain('id="email-hint"');
    expect(html).toContain('id="email-error"');
  });

  test("action cards render a real router link", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ActionCard to="/courses">
          <CardBody>Courses</CardBody>
        </ActionCard>
      </MemoryRouter>,
    );
    expect(html).toContain('class="card card--action"');
    expect(html).toContain('href="/courses"');
  });
});

describe("second UI slice", () => {
  test("tabs connect the selected tab and panel and hide other panels", () => {
    const html = renderToStaticMarkup(
      <Tabs
        label="Details"
        items={[
          { id: "a", label: "Overview", content: "First" },
          { id: "b", label: "Documents", content: "Second" },
        ]}
      />,
    );
    expect(html).toContain('role="tablist" aria-label="Details"');
    expect(html).toContain('aria-selected="true" tabindex="0"');
    expect(html).toContain('aria-selected="false" tabindex="-1"');
    expect(html).toContain('hidden=""');
  });

  test("closed accordion regions cannot receive focus", () => {
    const html = renderToStaticMarkup(
      <Accordion
        items={[
          {
            id: "one",
            title: "Question",
            content: <a href="/answer">Answer</a>,
          },
        ]}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('inert=""');
  });

  test("pagination keeps seven slots and real destinations", () => {
    expect(paginationModel(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
    const html = renderToStaticMarkup(
      <Pagination
        page={6}
        totalPages={12}
        href={(page) => `/items?page=${page}`}
        label="Pages"
        previousLabel="Previous"
        nextLabel="Next"
        pageLabel={(page) => `Page ${page}`}
        statusLabel={(page, total) => `Page ${page} of ${total}`}
      />,
    );
    expect(html).toContain('href="/items?page=6"');
    expect(html).toContain('aria-current="page"');
    const firstPage = renderToStaticMarkup(
      <Pagination
        page={1}
        totalPages={1}
        href={(target) => `/items?page=${target}`}
        label="Pages"
        previousLabel="Previous"
        nextLabel="Next"
        pageLabel={(target) => `Page ${target}`}
        statusLabel={(target, total) => `Page ${target} of ${total}`}
      />,
    );
    expect(firstPage).toContain('aria-disabled="true"');
  });

  test("table and progress have accessible names", () => {
    const table = renderToStaticMarkup(
      <DataTable caption="Applications">
        <tbody>
          <tr>
            <td>One</td>
          </tr>
        </tbody>
      </DataTable>,
    );
    expect(table).toContain(
      'role="region" aria-label="Applications" tabindex="0"',
    );
    expect(table).toContain("<caption>Applications</caption>");
    const progress = renderToStaticMarkup(
      <Progress label="Upload" value={35} />,
    );
    expect(progress).toContain("aria-labelledby=");
    expect(progress).toContain('value="35"');
  });
});

describe("choice controls", () => {
  test("a choice wraps the control and its label in one target", () => {
    const html = renderToStaticMarkup(
      <ChoiceGroup legend="Answer">
        <Choice type="radio" name="a" value="1" label="One" hint="first" />
      </ChoiceGroup>,
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain(
      '<label class="choice"><input class="choice__input"',
    );
    expect(html).toContain('type="radio"');
    expect(html).toContain('class="choice__hint"');
  });

  test("a switch is a checkbox with the switch role", () => {
    const html = renderToStaticMarkup(<Switch label="Unlocked" hideLabel />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("visually-hidden");
  });
});
