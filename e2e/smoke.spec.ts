import { expect, test } from '@playwright/test';

test.skip(!process.env.E2E, 'set E2E=1 with the dev stack running to execute browser smoke tests');

test('owner signs in, sees projects and opens a run graph', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@railyard.local');
  await page.getByLabel('Password').fill('railyard-demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByRole('link', { name: 'Storefront' }).click();
  await page.getByRole('link', { name: /#\d+/ }).first().click();
  await expect(page.getByRole('list', { name: 'Pipeline graph' })).toBeVisible();
});

test('planned sections are labelled', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('owner@railyard.local');
  await page.getByLabel('Password').fill('railyard-demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: /Secrets/ }).click();
  await expect(page.getByText(/RY-070/)).toBeVisible();
});
