import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import KeyValueEditor from './KeyValueEditor'

describe('KeyValueEditor', () => {
  it('starts empty and builds an object as rows are added', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KeyValueEditor initial={{}} onChange={onChange} />)
    expect(screen.getByText(/none yet/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add detail' }))
    await user.type(screen.getByLabelText('Detail 1 name'), 'room')
    await user.type(screen.getByLabelText('Detail 1 value'), 'B12')
    expect(onChange).toHaveBeenLastCalledWith({ room: 'B12' })

    await user.click(screen.getByRole('button', { name: 'Add detail' }))
    await user.type(screen.getByLabelText('Detail 2 name'), 'subject')
    await user.type(screen.getByLabelText('Detail 2 value'), 'Physics')
    expect(onChange).toHaveBeenLastCalledWith({ room: 'B12', subject: 'Physics' })
  })

  it('shows existing values and removes a row', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KeyValueEditor initial={{ room: 'B12', grade: '5' }} onChange={onChange} />)
    expect(screen.getByLabelText('Detail 1 name')).toHaveValue('room')
    expect(screen.getByLabelText('Detail 2 value')).toHaveValue('5')

    await user.click(screen.getByRole('button', { name: 'Remove detail 1' }))
    expect(onChange).toHaveBeenLastCalledWith({ grade: '5' })
  })

  it('keeps numbers and nested values that were not edited, and ignores blank names', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<KeyValueEditor initial={{ capacity: 30, tags: ['a', 'b'], room: 'B12' }} onChange={onChange} />)
    expect(screen.getByLabelText('Detail 1 value')).toHaveValue('30')

    await user.type(screen.getByLabelText('Detail 3 value'), '3') // edit only the string
    expect(onChange).toHaveBeenLastCalledWith({ capacity: 30, tags: ['a', 'b'], room: 'B123' })

    await user.click(screen.getByRole('button', { name: 'Add detail' }))
    await user.type(screen.getByLabelText('Detail 4 value'), 'no name given')
    expect(onChange).toHaveBeenLastCalledWith({ capacity: 30, tags: ['a', 'b'], room: 'B123' })
  })

  it('warns about two details with the same name', async () => {
    const user = userEvent.setup()
    render(<KeyValueEditor initial={{ room: 'B12' }} onChange={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Add detail' }))
    await user.type(screen.getByLabelText('Detail 2 name'), 'room')
    expect(screen.getAllByText(/only the last is kept/i).length).toBeGreaterThan(0)
  })
})
