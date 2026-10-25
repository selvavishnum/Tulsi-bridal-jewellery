/* Validation of the admin's changes to the category showcase
   (PATCH /api/admin/category-showcase). Server-side only — kept out of
   categoryShowcase.js so the storefront bundle doesn't ship zod. */
import { z } from 'zod';
import { ASPECTS, CARD_KEYS, DISPLAY_MODES, GRAVITY_VALUES, SIZES, ZOOM_RANGE } from '@/lib/categoryShowcase';

const FocusPatch = z.object({
  gravity: z.enum(GRAVITY_VALUES),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  zoom: z.number().min(ZOOM_RANGE.min).max(ZOOM_RANGE.max),
}).partial().strict();

const ItemPatch = z.object({
  key: z.enum(CARD_KEYS),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  image: z.union([z.literal(''), z.string().max(600).regex(/^https:\/\/[^\s"'<>]+$/)]).optional(),
  focus: FocusPatch.optional(),
}).strict();

export const ShowcasePatch = z.object({
  layout: z.object({
    layoutVariant: z.enum(Object.keys(ASPECTS)),
    displayMode: z.enum(DISPLAY_MODES.map((m) => m.value)),
    size: z.enum(SIZES),
  }).partial().strict().optional(),
  items: z.array(ItemPatch).max(CARD_KEYS.length).optional(),
  /* The full new order, as card keys. */
  order: z.array(z.enum(CARD_KEYS)).length(CARD_KEYS.length).refine((a) => new Set(a).size === a.length, 'order must list each card once').optional(),
}).strict().refine((p) => p.layout || p.items?.length || p.order, 'nothing to change');
