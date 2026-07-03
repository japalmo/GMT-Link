-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleKey_fkey" FOREIGN KEY ("roleKey") REFERENCES "Role"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
