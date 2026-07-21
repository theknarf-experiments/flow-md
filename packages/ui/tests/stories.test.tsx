// @vitest-environment jsdom
//
// Storybook tests via portable stories: every story is composed (decorators
// included) and rendered with Testing Library, with behavioural assertions
// on top — so a story that stops rendering fails CI, not just visual review.

import { composeStories } from '@storybook/react-vite'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as calendarStories from '../../view-ics/src/Calendar.stories.js'
import * as dataViewStories from '../src/DataView.stories.js'
import * as fileTreeStories from '../../view-filetree/src/FileTree.stories.js'
import * as gridStories from '../src/EditableGrid.stories.js'
import * as rawEditorStories from '../src/RawEditor.stories.js'

const fileTree = composeStories(fileTreeStories)
const ics = composeStories(calendarStories)
const dataView = composeStories(dataViewStories)
const grid = composeStories(gridStories)
const rawEditor = composeStories(rawEditorStories)

afterEach(cleanup)

describe('FileTree stories', () => {
  it('Vault renders every file with an icon, folders first', async () => {
    render(<fileTree.Vault />)
    await waitFor(() => {
      expect(screen.getAllByTestId('tree-leaf')).toHaveLength(7)
    })
    expect(screen.getByText('tasks.md')).toBeTruthy()
    // Empty folder from `dirs` still shows.
    expect(screen.getByText(/empty-folder/)).toBeTruthy()
    // Icon presence: the ics leaf carries the calendar emoji.
    expect(screen.getByText('work.ics').textContent).toContain('🗓️')
  })

  it('Empty renders no leaves', async () => {
    render(<fileTree.Empty />)
    expect(screen.queryAllByTestId('tree-leaf')).toHaveLength(0)
  })
})

describe('Calendar stories', () => {
  it('Agenda groups events from Event facts', () => {
    render(<ics.Agenda />)
    expect(screen.getByText('Project kickoff')).toBeTruthy()
    // The timeless event renders as "all day".
    expect(screen.getByText(/all day/)).toBeTruthy()
    // Cancelled events render struck through but present.
    expect(screen.getByText('Team offsite')).toBeTruthy()
    expect(screen.getByText('cancelled')).toBeTruthy()
  })

  it('EmptyCalendar shows the empty hint', () => {
    render(<ics.EmptyCalendar />)
    expect(screen.getByText(/no events/)).toBeTruthy()
  })
})

describe('DataView stories', () => {
  it('WithRows renders columns, rows and writable markers', () => {
    render(<dataView.WithRows />)
    expect(screen.getByTestId('dataview')).toBeTruthy()
    expect(screen.getByText('water the plants')).toBeTruthy()
    expect(screen.getByText('3 rows')).toBeTruthy()
    // Two writable columns carry the pen marker.
    expect(screen.getAllByText('✎')).toHaveLength(2)
  })

  it('ReadOnly drops the edit affordance when no commit handler is given', () => {
    render(<dataView.ReadOnly />)
    expect(screen.queryByText('✎')).toBeNull()
    // The rows still render — it's editing that's gone, not the data.
    expect(screen.getByText('water the plants')).toBeTruthy()
  })

  it('EmptyResult and NoServerMatch render their fallbacks', () => {
    render(<dataView.EmptyResult />)
    expect(screen.getByText('no rows')).toBeTruthy()
    cleanup()
    render(<dataView.NoServerMatch />)
    expect(screen.getByText(/no results yet/)).toBeTruthy()
  })
})

describe('EditableGrid stories', () => {
  it('CsvMode renders sortable headers and every cell', () => {
    render(<grid.CsvMode />)
    expect(screen.getByText('keyboard')).toBeTruthy()
    expect(screen.getByText('3 rows')).toBeTruthy()
    // Sortable headers expose their state to assistive tech.
    expect(screen.getByText('category').closest('th')?.getAttribute('aria-sort')).toBe('none')
  })

  it('MarkdownMode offers a column control instead of sorting', () => {
    render(<grid.MarkdownMode />)
    expect(screen.getByTitle('add column')).toBeTruthy()
    expect(screen.getByText('item').closest('th')?.getAttribute('aria-sort')).toBeNull()
  })

  it('Empty still renders its header row', () => {
    render(<grid.Empty />)
    expect(screen.getByText('name')).toBeTruthy()
    expect(screen.getByText('0 rows')).toBeTruthy()
  })
})

describe('RawEditor stories', () => {
  it('Default starts clean and goes dirty on input', async () => {
    const { container } = render(<rawEditor.Default />)
    expect(screen.getByText('clean')).toBeTruthy()
    const textarea = container.querySelector('textarea')
    if (!textarea) throw new Error('no textarea')
    fireEvent.change(textarea, { target: { value: 'edited' } })
    expect(screen.getByText('unsaved changes')).toBeTruthy()
    // Save is only offered once there's something to save.
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(screen.getByText('clean')).toBeTruthy())
  })

  it('SaveFails surfaces the reason and keeps the draft', async () => {
    const { container } = render(<rawEditor.SaveFails />)
    const textarea = container.querySelector('textarea')
    if (!textarea) throw new Error('no textarea')
    fireEvent.change(textarea, { target: { value: 'edited' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(screen.getByText(/no longer contains/)).toBeTruthy())
    expect(textarea.value).toBe('edited')
  })
})
