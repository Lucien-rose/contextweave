export function ensureArcSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS arcs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      sensitivity TEXT NOT NULL CHECK (sensitivity IN ('private', 'intimate')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS arc_materials (
      arc_id TEXT NOT NULL REFERENCES arcs(id) ON DELETE CASCADE,
      material_type TEXT NOT NULL CHECK (material_type IN ('memory', 'family', 'handoff', 'source')),
      material_id TEXT NOT NULL,
      chapter TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      attached_at TEXT NOT NULL,
      PRIMARY KEY (arc_id, material_type, material_id)
    );
    CREATE INDEX IF NOT EXISTS idx_arc_materials_target ON arc_materials(material_type, material_id);
    CREATE INDEX IF NOT EXISTS idx_arc_materials_order ON arc_materials(arc_id, position, attached_at);

    -- Polymorphic references never own or snapshot their targets.
    CREATE TRIGGER IF NOT EXISTS arc_memory_deleted AFTER DELETE ON memories BEGIN
      DELETE FROM arc_materials WHERE material_type = 'memory' AND material_id = OLD.id;
      DELETE FROM arc_materials WHERE material_type = 'family' AND material_id = OLD.family_key
        AND NOT EXISTS (SELECT 1 FROM memories WHERE family_key = OLD.family_key);
    END;
    CREATE TRIGGER IF NOT EXISTS arc_handoff_deleted AFTER DELETE ON continuity_handoffs BEGIN
      DELETE FROM arc_materials WHERE material_type = 'handoff' AND material_id = OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS arc_source_deleted AFTER DELETE ON source_materials BEGIN
      DELETE FROM arc_materials WHERE material_type = 'source' AND material_id = OLD.id;
    END;
  `);
}
