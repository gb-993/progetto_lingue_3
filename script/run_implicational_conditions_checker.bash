#!/usr/bin/env bash

export BANNER=$(yes "#" | tr -d "\n" | head -c 80)
export CHECKER="src/10_conditional_implication_checker.py"

export GDRIVE_TABLE_A="datasets/2025_05_07__google_drive/04_TableA_2025_SI.xlsx"
export LAST_TABLE_A="datasets/2025_04_11__last_email/04_TableA_2025SI.xlsx"
export NEW_TABLE_A="datasets/2024_03_19__formerly_new/04_new_TableA.xlsx"
export FIRST_TABLE_A="datasets/2023_06_29__first_tables/04_Guardiano_et_al_Table_A_2023_04_03.xlsx"

echo -e "${BANNER}\n${BANNER}\n${BANNER}\n${BANNER}"
python3 "${CHECKER}"			\
	-i "${GDRIVE_TABLE_A}"		\
	-s "TABLE A_2024 (2)"		\
	-c "Implicational Condition(s)"	\
	-I "${GDRIVE_TABLE_A}"		\
	-v				\
2>&1 | tee checked_gogole_drive.log
echo "Press Ctrl+D to continue"; cat

echo -e "${BANNER}\n${BANNER}\n${BANNER}\n${BANNER}"
python3 "${CHECKER}"			\
	-i "${LAST_TABLE_A}"		\
	-s "TABLE A_2024 (2)"		\
	-c "Implicational Condition(s)"	\
	-I "${LAST_TABLE_A}"		\
	-v				\
2>&1 | tee checked_last_email.log
echo "Press Ctrl+D to continue"; cat

echo -e "${BANNER}\n${BANNER}\n${BANNER}\n${BANNER}"
python3 "${CHECKER}"			\
	-i "${FIRST_TABLE_A}"		\
	-s "TABLE A_2023"		\
	-I "${NEW_TABLE_A}"		\
	-S "Italia+GRK"			\
	-fv				\
2>&1 | tee checked_penultimate.log
echo "Press Ctrl+D to continue"; cat

echo -e "${BANNER}\n${BANNER}\n${BANNER}\n${BANNER}"
python3 "${CHECKER}"			\
	-i "${FIRST_TABLE_A}"		\
	-s "TABLE A_2023"		\
	-I "${FIRST_TABLE_A}"		\
	-S "TABLE A_2023"		\
	-fv				\
2>&1 | tee checked_first.log
