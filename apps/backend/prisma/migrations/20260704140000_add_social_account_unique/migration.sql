-- AlterTable
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_organizationId_zernioAccountId_key" UNIQUE ("organizationId", "zernioAccountId");
