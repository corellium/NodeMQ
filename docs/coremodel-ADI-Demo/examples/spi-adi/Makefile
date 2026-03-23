-include Makefile.local

HOSTCC = $(PREFIX)gcc
HOSTAR = $(PREFIX)ar
CFLAGS = -g -Wall -I$(LIBSRC) 
LFLAGS = -lpthread
LIBSRC ?= ../../

all: coremodel-spi-adi coremodel-spi-max30123-file

MAX30123_SRCS = coremodel-spi-max30123-file.c coremodel-spi-max30123-thread.c
MAX30123_HEADERS = max30123.h coremodel-spi-max30123.h
MAX30123_LIBS = libcoremodel.a libcoremodel_telemetry.a

coremodel-spi-adi: coremodel-spi-adi.c libcoremodel.a
	$(HOSTCC) $(CFLAGS) $(LFLAGS) -o $@ $^

coremodel-spi-max30123-file: $(MAX30123_SRCS) $(MAX30123_HEADERS) $(MAX30123_LIBS)
	$(HOSTCC) $(CFLAGS) $(LFLAGS) -o $@ $(MAX30123_SRCS) $(MAX30123_LIBS)

libcoremodel.a: $(LIBSRC)coremodel.c $(LIBSRC)coremodel.h
	$(HOSTCC) $(CFLAGS) -c -o coremodel.o $(LIBSRC)coremodel.c
	$(HOSTAR) cr $@ coremodel.o
	@rm -f coremodel.o

libcoremodel_telemetry.a: $(LIBSRC)coremodel_telemetry.c $(LIBSRC)coremodel_telemetry.h
	$(HOSTCC) $(CFLAGS) -c -o coremodel_telemetry.o $<
	$(HOSTAR) cr $@ coremodel_telemetry.o
	@rm -f coremodel_telemetry.o

clean:
	rm -rf coremodel-spi-adi coremodel-spi-max30123-file *.a *.o *.dSYM
