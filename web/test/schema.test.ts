import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { harness, type Harness } from './helpers.js'
import * as projects from '../src/repo/projects.js'
import * as versions from '../src/repo/versions.js'

let h: Harness
beforeEach(async () => { h = await harness() })
afterEach(async () => { await h.close() })

describe('the shape of the data', () => {
  it('applies every migration, and applying twice changes nothing', async () => {
    const { migrate } = await import('../src/migrate.js')
    expect(await migrate(h.db)).toEqual([])
  })

  it('seeds the demo project with five versions, newest numbered highest', async () => {
    const project = await projects.bySlug(h.db, 'zoom-transcripts-to-nvivo')
    expect(project?.name).toBe('Zoom transcripts to NVivo')
    const list = await versions.list(h.db, project!.id)
    expect(list.map((v) => v.number)).toEqual([5, 4, 3, 2, 1])
  })

  it('puts the suggester on version 4 and nobody else', async () => {
    const project = await projects.bySlug(h.db, 'zoom-transcripts-to-nvivo')
    const list = await versions.list(h.db, project!.id)
    const credited = list.filter((v) => v.suggested_by !== null)
    expect(credited).toHaveLength(1)
    expect(credited[0]!.number).toBe(4)
  })

  it('hands out the next number, so versions only ever append', async () => {
    const project = await projects.bySlug(h.db, 'zoom-transcripts-to-nvivo')
    const owner = project!.owner
    const next = await versions.append(h.db, {
      project_id: project!.id,
      note: 'Went back to the way version 3 worked.',
      created_by: owner,
    })
    expect(next.number).toBe(6)
    const after = await versions.list(h.db, project!.id)
    expect(after).toHaveLength(6)
  })

  it('refuses two versions with the same number', async () => {
    const project = await projects.bySlug(h.db, 'zoom-transcripts-to-nvivo')
    await expect(
      h.db.query(
        'insert into versions (project_id, number, note, created_by) values ($1, 5, $2, $3)',
        [project!.id, 'a clash', project!.owner],
      ),
    ).rejects.toThrow()
  })

  it('refuses a visibility that is not one of the three', async () => {
    await expect(
      h.db.query(
        `insert into projects (owner, slug, name, visibility)
         values ((select id from users limit 1), 'bad', 'Bad', 'semi-public')`,
      ),
    ).rejects.toThrow()
  })

  it('makes a free slug, and keeps making free ones', async () => {
    expect(await projects.freeSlug(h.db, 'Zoom transcripts to NVivo')).toBe(
      'zoom-transcripts-to-nvivo-2',
    )
    expect(await projects.freeSlug(h.db, 'Something else entirely')).toBe('something-else-entirely')
  })

  it('throws away a project cleanly, versions and all', async () => {
    const project = await projects.bySlug(h.db, 'zoom-transcripts-to-nvivo')
    await h.db.query('delete from projects where id = $1', [project!.id])
    const left = await h.db.query('select * from versions where project_id = $1', [project!.id])
    expect(left.rows).toHaveLength(0)
  })
})
