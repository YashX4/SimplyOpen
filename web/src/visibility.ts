/**
 * The three visibility values, enforced in one place.
 *
 * P3 offers only me, anyone with the link, and everyone. Browse lists the
 * third. A link holder can open the second but never finds it by searching.
 * The first needs the owner.
 *
 * Every route asks this. Nothing else decides.
 */

import type { Project, Visibility } from './types.js'

export function canSee(project: Pick<Project, 'visibility' | 'owner'>, viewer: string | null): boolean {
  if (project.visibility === 'public' || project.visibility === 'link') return true
  return viewer !== null && viewer === project.owner
}

export function canEdit(project: Pick<Project, 'owner'>, viewer: string | null): boolean {
  return viewer !== null && viewer === project.owner
}

/** Only these ever appear in browse or search. */
export const LISTABLE: Visibility = 'public'
