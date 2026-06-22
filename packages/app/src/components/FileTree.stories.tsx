import type { Cell, FlowMdHost } from '@flow-md/view-api'
import { FlowMdHostProvider } from '@flow-md/view-api'
import { FileTree } from '@flow-md/view-filetree'
import type { Meta, StoryObj } from '@storybook/react-vite'

// FileTree is a query-driven view plugin: it asks the host for `File(...)` and
// `Folder(...)` rows. These stories provide a mock host returning canned rows,
// so the tree renders without a running server.
function mockHost(files: string[], folders: string[]): FlowMdHost {
  return {
    useQuery: (source: string) =>
      source.startsWith('Folder')
        ? {
            columns: ['path'],
            rows: folders.map((p) => [p] as Cell[]),
            writable: ['path'],
            error: null,
            ready: true,
            refresh: () => {},
          }
        : {
            columns: ['path', 'mtime'],
            rows: files.map((p) => [p, 0] as Cell[]),
            writable: ['path'],
            error: null,
            ready: true,
            refresh: () => {},
          },
    useFiles: () => files,
    updateCell: async () => {},
    deleteRow: async () => {},
    insertRow: async () => {},
    resolveWiki: () => null,
    openNote: () => {},
  }
}

const VAULT_FILES = [
  'index.md',
  'docs/tasks.md',
  'docs/calendar.md',
  'docs/sub/deep.md',
  'data/budget.csv',
  'cal/work.ics',
  'board.mdx',
]
const VAULT_DIRS = ['docs', 'docs/sub', 'data', 'cal', 'empty-folder']

const meta: Meta<typeof FileTree> = {
  title: 'Sidebar/FileTree',
  component: FileTree,
}
export default meta
type Story = StoryObj<typeof FileTree>

export const Vault: Story = {
  args: { files: 'File(path, mtime)', folders: 'Folder(path)' },
  decorators: [
    (Story) => (
      <FlowMdHostProvider host={mockHost(VAULT_FILES, VAULT_DIRS)}>
        <Story />
      </FlowMdHostProvider>
    ),
  ],
}

export const Empty: Story = {
  args: { files: 'File(path, mtime)', folders: 'Folder(path)' },
  decorators: [
    (Story) => (
      <FlowMdHostProvider host={mockHost([], [])}>
        <Story />
      </FlowMdHostProvider>
    ),
  ],
}
