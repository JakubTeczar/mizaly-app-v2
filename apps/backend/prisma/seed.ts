// Seeds a demo AdminUser and a demo Organization + owner User for local testing.
// Run via `yarn prisma:seed` (or automatically after `prisma migrate dev`).

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admin@mizaly.local";
const ADMIN_PASSWORD = "admin1234";

const DEMO_ORG_NAME = "Demo Organization";
const DEMO_USER_EMAIL = "demo@mizaly.local";
const DEMO_USER_PASSWORD = "demo1234";

async function main() {
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await prisma.adminUser.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      passwordHash: adminPasswordHash,
    },
  });

  const existingDemoUser = await prisma.user.findUnique({
    where: { email: DEMO_USER_EMAIL },
  });

  if (!existingDemoUser) {
    const demoPasswordHash = await bcrypt.hash(DEMO_USER_PASSWORD, 10);
    const organization = await prisma.organization.create({
      data: { name: DEMO_ORG_NAME },
    });
    await prisma.user.create({
      data: {
        organizationId: organization.id,
        email: DEMO_USER_EMAIL,
        passwordHash: demoPasswordHash,
        role: "owner",
      },
    });
  }

  console.log("Seed complete. Demo credentials:");
  console.log("-----------------------------------");
  console.log("Admin panel login:");
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
  console.log("");
  console.log("Demo organization user login:");
  console.log(`  organization: ${DEMO_ORG_NAME}`);
  console.log(`  email:        ${DEMO_USER_EMAIL}`);
  console.log(`  password:     ${DEMO_USER_PASSWORD}`);
  console.log("-----------------------------------");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
