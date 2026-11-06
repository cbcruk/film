import { useCallback, useMemo, useState } from 'react'
import {
  Table,
  pixel,
  proportional,
  useTableRowStatus,
  useTableSortable,
} from '@astryxdesign/core/Table'
import type { TableColumn, TablePlugin } from '@astryxdesign/core/Table'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { VideoList } from '../lib/types.ts'

type Video = VideoList['videos'][number]

/** Table은 Record 행을 받는다 */
interface Row extends Record<string, unknown> {
  readonly id: string
  readonly name: string
  readonly folder: string
  readonly size: number
  readonly mtime: string
  readonly cached: boolean
}

type SortKey = 'name' | 'size' | 'mtime'
type Sort = Array<{
  sortKey: SortKey
  direction: 'ascending' | 'descending'
}>

interface Props {
  readonly videos: ReadonlyArray<Video>
  readonly openId: string | undefined
  readonly onOpen: (id: string) => void
  /** 좁은 폭: 크기·수정일 열을 이름 아래로 접는다 */
  readonly isStacked: boolean
}

export const formatSize = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 ** 2
      ? `${Math.round(bytes / 1024 ** 2)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

/** 열린 행 표시. 선택 플러그인이 행 스타일을 덮어쓰므로 칸에 칠한다 (템플릿과 같은 방식) */
const OPEN_CELL_STYLE = { backgroundColor: 'var(--color-accent-muted)' }

/** 행 안의 다른 조작 요소를 누른 것은 행 열기로 치지 않는다 */
const isRowItself = (target: EventTarget | null) =>
  !(target as HTMLElement | null)?.closest('button, input, a, label')

const compare = (a: Row, b: Row, key: SortKey) =>
  key === 'size'
    ? a.size - b.size
    : key === 'mtime'
      ? a.mtime.localeCompare(b.mtime)
      : a.name.localeCompare(b.name, 'ko', { numeric: true })

export function VideoTable({ videos, openId, onOpen, isStacked }: Props) {
  // 서버가 최근 수정순으로 준다. 헤더를 누르면 바뀐다
  const [sort, setSort] = useState<Sort>([])

  const rows = useMemo(() => {
    const data: Row[] = videos.map((v) => ({ ...v }))
    const [first] = sort
    if (first === undefined) return data
    const sign = first.direction === 'ascending' ? 1 : -1
    return data.sort((a, b) => sign * compare(a, b, first.sortKey))
  }, [videos, sort])

  const sortable = useTableSortable<Row>({
    sort,
    onSortChange: (next) => setSort(next as Sort),
  })

  const rowStatus = useTableRowStatus<Row>({
    getStatus: useCallback(
      (row: Row) =>
        row.cached ? { color: 'accent', label: '썸네일 있음' } : null,
      [],
    ),
  })

  const open: TablePlugin<Row> = useMemo(
    () => ({
      transformBodyRow: (props, row) => ({
        ...props,
        htmlProps: {
          ...props.htmlProps,
          tabIndex: 0,
          'aria-current': row.id === openId ? true : undefined,
          'data-video': row.name,
          onClick: (e) => {
            if (isRowItself(e.target)) onOpen(row.id)
          },
          onKeyDown: (e) => {
            if ((e.key !== 'Enter' && e.key !== ' ') || !isRowItself(e.target))
              return
            e.preventDefault()
            onOpen(row.id)
          },
        },
      }),
      transformBodyCell: (props, _column, row) =>
        row.id === openId
          ? {
              ...props,
              htmlProps: {
                ...props.htmlProps,
                style: { ...props.htmlProps.style, ...OPEN_CELL_STYLE },
              },
            }
          : props,
    }),
    [openId, onOpen],
  )

  const columns = useMemo((): TableColumn<Row>[] => {
    const name: TableColumn<Row> = {
      key: 'name',
      header: '파일',
      width: proportional(1, { minWidth: 160 }),
      sortable: true,
      renderCell: (row) => (
        <VStack gap={0.5}>
          <Text maxLines={1}>{row.name}</Text>
          {(row.folder !== '' || isStacked) && (
            <Text type="supporting" maxLines={1}>
              {[
                row.folder && `${row.folder}/`,
                isStacked && formatSize(row.size),
                isStacked && formatDate(row.mtime),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </VStack>
      ),
    }
    if (isStacked) return [name]
    return [
      name,
      {
        key: 'size',
        header: '크기',
        width: pixel(88),
        align: 'end',
        sortable: true,
        renderCell: (row) => (
          <Text hasTabularNumbers color="secondary">
            {formatSize(row.size)}
          </Text>
        ),
      },
      {
        key: 'mtime',
        header: '수정일',
        width: pixel(168),
        sortable: true,
        renderCell: (row) => (
          <Text hasTabularNumbers color="secondary">
            {formatDate(row.mtime)}
          </Text>
        ),
      },
    ]
  }, [isStacked])

  return (
    <Table
      data={rows}
      columns={columns}
      idKey="id"
      plugins={{ sortable, rowStatus, open }}
      density="balanced"
      dividers="none"
      hasHover
      textOverflow="truncate"
    />
  )
}
