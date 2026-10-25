export function providerOutputSchema(schema, protocol) {
  const output = structuredClone(schema);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    delete node.$schema;
    delete node.default;
    if (protocol === "anthropic") {
      const removed = {};
      for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "pattern"]) {
        if (Object.hasOwn(node, key)) { removed[key] = node[key]; delete node[key]; }
      }
      if (node.minItems > 1) { removed.minItems = node.minItems; delete node.minItems; }
      if (Object.keys(removed).length) node.description = `${node.description || ""} Constraints enforced locally: ${JSON.stringify(removed)}`.trim();
    }
    for (const child of Object.values(node.properties || {})) visit(child);
    for (const child of Object.values(node.$defs || {})) visit(child);
    visit(node.items);
    for (const key of ["anyOf", "allOf", "oneOf"]) (node[key] || []).forEach(visit);
  };
  visit(output);
  return output;
}
