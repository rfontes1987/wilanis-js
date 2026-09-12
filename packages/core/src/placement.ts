/**
 * Where a kind may live (D008). A feature's documents sit in one of three layer directories and the layer is
 * the rule: `edge/` speaks the world, `domain/` holds the business rules, `data/` translates and carries the
 * effects. A connection is a channel shared across features, so it stays at the tree's root.
 */
import { type Kind, type Layer, layerOf } from './model.js';
import { stem } from './paths.js';
import type { Refusal } from './registry.js';

interface Home {
  layers?: Layer[];
  dir?: string;
  why: string;
}

/** The one place placement lives: the layers (or top-level directory) each kind is at home in, and why. */
export const HOME: Partial<Record<Kind, Home>> = {
  trigger: { layers: ['edge'], why: "a trigger is a way in: it speaks the world's vocabulary" },
  policy: { layers: ['edge'], why: 'a policy gates a way in: it reads the request the way a trigger does' },
  graph: { layers: ['domain', 'data'], why: 'a graph is business rules (domain/) or a translation (data/)' },
  binding: { layers: ['data'], why: "a binding says how a domain port is met, which is the data layer's job" },
  store: { layers: ['data'], why: "a store says how records are kept, which is the data layer's job" },
  port: { layers: ['domain'], why: 'a domain port is the contract the business offers' },
  shape: { layers: ['edge', 'domain'], why: "a shape is the world's (edge/) or ours (domain/)" },
  resolvers: {
    layers: ['edge'],
    why: "a resolvers document names what is read from the request, which is the world's vocabulary",
  },
  connection: { dir: 'connections', why: 'a connection is a channel to an external system, shared across features' },
  scenario: { dir: 'scenarios', why: 'a scenario is a recorded run' },
};

/** A document as it is about to be placed: its kind, its tree path, the feature it sits in, and its content. */
export interface Placement {
  kind: Kind;
  file: string;
  feature: string | undefined;
  doc: unknown;
}

/** The refusal for a document that is not where its kind lives, or null when it is home. */
export function misplaced(placement: Placement): Refusal | null {
  const home = HOME[placement.kind];
  if (!home) return null;
  if (home.dir) return misplacedDir(placement, home.dir, home.why);
  const layers = home.layers ?? [];
  if (!placement.feature) return outsideFeature(placement, layers, home.why);
  const layer = layerOf(`@${placement.file}`);
  const disagrees = placement.kind === 'shape' && layer ? shapeDisagrees(placement, layer) : null;
  if (disagrees) return disagrees;
  if (layer && layers.includes(layer)) return null;
  return wrongLayer(placement, layers, layer, home.why);
}

function misplacedDir(placement: Placement, dir: string, why: string): Refusal | null {
  const { kind, file } = placement;
  if (file.split('/')[0] === dir) return null;
  return {
    code: 'D008',
    file,
    message: `a ${kind} lives under ${dir}/`,
    hint: `${why}; move it to ${dir}/${stem(file)}.${kind}.json`,
  };
}

function outsideFeature(placement: Placement, layers: Layer[], why: string): Refusal {
  const { kind, file } = placement;
  return {
    code: 'D008',
    file,
    message: `a ${kind} lives inside a feature, under ${layers.map(layer => `${layer}/`).join(' or ')}`,
    hint: `${why}; move it to features/<name>/${layers[0]}/`,
  };
}

/** A shape says its layer twice -- in `layer` and in the directory. They must agree, and the directory wins. */
function shapeDisagrees(placement: Placement, layer: Layer): Refusal | null {
  const written = (placement.doc as { layer?: string }).layer;
  const declared = written === 'edge' ? 'edge' : 'domain';
  if (declared === layer) return null;
  const setTo = layer === 'edge' ? 'edge' : 'core';
  return {
    code: 'D008',
    file: placement.file,
    at: 'layer',
    message: `shape declares layer '${written}' but sits in ${layer}/`,
    hint: `a shape's layer is where it lives; move it to features/${placement.feature}/${declared}/, or set "layer": "${setTo}"`,
  };
}

function wrongLayer(placement: Placement, layers: Layer[], layer: Layer | undefined, why: string): Refusal {
  const { kind, file, feature } = placement;
  return {
    code: 'D008',
    file,
    message: layer
      ? `a ${kind} may not live in the ${layer} layer`
      : `a ${kind} must sit in a layer directory (${layers.join(', ')})`,
    hint: `${why}; move it to features/${feature}/${layers[0]}/${stem(file)}.${kind}.json`,
  };
}
