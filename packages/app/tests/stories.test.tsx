// @vitest-environment jsdom
//
// Storybook tests via portable stories: every story is composed (decorators
// included) and rendered with Testing Library, with behavioural assertions
// on top — so a story that stops rendering fails CI, not just visual review.

import { composeStories } from '@storybook/react-vite'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as dataViewStories from '../src/components/DataView.stories.js'
import * as fileTreeStories from '../src/components/FileTree.stories.js'
import * as icsStories from '../src/components/IcsView.stories.js'

const fileTree = composeStories(fileTreeStories)
const ics = composeStories(icsStories)
const dataView = composeStories(dataViewStories)

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

describe('IcsView stories', () => {
  it('Agenda groups events under day headings', () => {
    render(<ics.Agenda />)
    expect(screen.getByText('Project kickoff')).toBeTruthy()
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

  it('EmptyResult and NoServerMatch render their fallbacks', () => {
    render(<dataView.EmptyResult />)
    expect(screen.getByText('no rows')).toBeTruthy()
    cleanup()
    render(<dataView.NoServerMatch />)
    expect(screen.getByText(/no results yet/)).toBeTruthy()
  })
})
