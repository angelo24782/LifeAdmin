import { expect, test } from '@playwright/test'

test('home page renders without errors or horizontal scroll', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('/')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Le scadenze della tua vita, sotto controllo.' }),
  ).toBeVisible()
  await expect(page.getByTestId('platform-label')).toHaveText('Piattaforma: Web')

  const hasHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(hasHorizontalScroll).toBe(false)
  expect(errors).toEqual([])
})
