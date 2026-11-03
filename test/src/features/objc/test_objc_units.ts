import {
  EvidenceAccessor,
  EvidenceInventory,
  EvidenceObjcAdapter,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

import { EvidenceTestSourceSnapshot } from "../../internal/EvidenceTestSourceSnapshot";

/**
 * Reconciles Objective-C headers and implementations into owned public units.
 *
 * Class, category, protocol, and selector sites can merge while retaining their
 * distinct ownership and addresses.
 *
 * 1. Analyze matching headers and implementations with categories and protocols.
 * 2. Verify exact public units, merged sites, parentage, and target resolution.
 * 3. Require diagnostics-free complete extraction.
 *
 * @evidence contracts/testing.md#behavioral-verification Analyzes headers and implementations with categories and protocols and asserts units, merged sites, parents and target resolution.
 * @evidence contracts/testing.md#independent-expectations Expected units are the declared surface written in the test.
 * @evidence contracts/testing.md#distinguishing-cases Covers classes, categories, protocols, selectors and merged sites with complete extraction.
 * @evidence contracts/testing.md#execution-ownership The exported test_objc_units is discovered by DynamicExecutor under test/src/features and calls maintained source in-process; it installs no consumer, packs nothing and spawns no CLI.
 */
export async function test_objc_units(): Promise<void> {
  const inventory = await new EvidenceObjcAdapter().analyze(
    EvidenceTestSourceSnapshot.combine([
      EvidenceTestSourceSnapshot.create(
        "src/Widget.h",
        dedent`
      @class NSObject;
      @protocol Forward;
      @interface Widget : NSObject {
        int protectedValue;
        @private int secret;
        @public int count, total;
        @package int packageValue;
      }
      @property int value;
      @property(class) int value;
      - (int)send:(int)x to:(int)y;
      + (int)send:(int)x to:(int)y;
      @end
      @interface Widget (Extras)
      - (void)extra;
      @end
      @protocol Widget
      @optional
      - (void)optional;
      @required
      @property int required;
      @end
      extern int run(int value);
      static int local(void);
    `,
        ["src/Widget.h", "alias/Widget.h"],
      ),
      EvidenceTestSourceSnapshot.create(
        "src/Widget.m",
        dedent`
      #import "Widget.h"
      @interface Widget ()
      @property int value;
      @property int hidden;
      - (void)privateMethod;
      @end
      @implementation Widget
      - (int)send:(int)x to:(int)y { return x+y; }
      - (void)privateMethod {}
      @synthesize value = _value;
      @end
      @implementation Widget (Extras)
      - (void)extra {}
      @end
      int run(int value) { return value; }
      static int local(void) { return 0; }
    `,
      ),
    ]),
  );

  TestValidator.equals(
    "complete Objective-C declarations",
    inventory.diagnostics,
    [],
  );
  TestValidator.equals(
    "exact public surface",
    inventory.units
      .map((unit) => `${unit.symbol}:${EvidenceAccessor.format(unit.identity)}`)
      .sort((left, right) => left.localeCompare(right)),
    [
      "type:Widget",
      'scope:["Widget(Extras)"]',
      'type:["protocol(Widget)"]',
      'property:Widget["ivar:count"]',
      'property:Widget["ivar:total"]',
      "property:Widget.value",
      'property:Widget["class:value"]',
      'function:Widget["-send:to:"]',
      'function:Widget["+send:to:"]',
      'function:["Widget(Extras)"]["-extra"]',
      'function:["protocol(Widget)"]["-optional"]',
      'property:["protocol(Widget)"].required',
      "function:run",
    ].sort((left, right) => left.localeCompare(right)),
  );
  const widget = inventory.units.find((unit) => unit.name === "Widget");
  const method = inventory.units.find((unit) => unit.name === "-send:to:");
  if (widget === undefined || method === undefined)
    throw new Error("Missing merged units.");
  TestValidator.equals(
    "interface, extension, implementation merge",
    widget.sites.length,
    3,
  );
  TestValidator.equals(
    "selector declaration and definition merge",
    method.sites.length,
    2,
  );
  TestValidator.equals(
    "method parent remains nominal identity",
    method.parentId,
    widget.id,
  );
  const graph = new EvidenceInventory([inventory]);
  const selected = inventory.units.map((unit) => unit.id);
  for (const file of [
    "/project/src/Widget.h",
    "/project/alias/Widget.h",
    "/project/src/Widget.m",
  ])
    TestValidator.equals(
      `merged selector alias ${file}`,
      graph.resolve({ file, segments: ["Widget", "-send:to:"] }, selected)
        .status,
      "resolved",
    );
  TestValidator.equals(
    "category members do not acquire a fabricated class owner",
    graph.resolve(
      { file: "/project/src/Widget.h", segments: ["Widget", "-extra"] },
      selected,
    ).status,
    "missing",
  );
  TestValidator.equals(
    "physical declaration hosts include merged sites",
    inventory.hosts.length,
    17,
  );
  const shared = inventory.hosts.filter((host) => host.unitIds.length === 2);
  TestValidator.equals(
    "one ivar declaration carries both names",
    shared.length,
    1,
  );
}
