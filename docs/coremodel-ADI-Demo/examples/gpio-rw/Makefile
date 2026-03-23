#  * Copyright (C) 2025 Corellium LLC
#  * All rights reserved.
-include Makefile.local

HOSTCC = $(PREFIX)gcc
HOSTAR = $(PREFIX)ar
CFLAGS = -g -Wall -I$(LIBSRC)
LIBSRC ?= ../../

all: coremodel-gpio-rw

coremodel-gpio-rw: coremodel-gpio-rw.c libcoremodel.a
	$(HOSTCC) $(CFLAGS) -o $@ $^

libcoremodel.a: $(LIBSRC)coremodel.c $(LIBSRC)coremodel.h
	$(HOSTCC) $(CFLAGS) -c -o coremodel.o $(LIBSRC)coremodel.c
	$(HOSTAR) cr $@ coremodel.o
	@rm -f coremodel.o

clean:
	rm -f coremodel-gpio-rw libcoremodel.a
