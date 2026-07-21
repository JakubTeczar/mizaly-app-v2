-- AlterTable
ALTER TABLE "CreatorAuditPost" ADD COLUMN     "formatDetail" TEXT,
ALTER COLUMN "imageUrls" DROP DEFAULT;
